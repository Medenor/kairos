import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_COPY_LIMIT_BYTES, DEFAULT_EXCLUSIONS, checkFolder, cleanWorkdir, diffWorkdir, prepareWorkdir,
} from './workdir.js'

// os.tmpdir() is under /var on macOS and therefore a refused location: work under the gitignored <repo>/.test-tmp.
const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')
const created = []
const restore = []

async function tmp(label) {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(path.join(TEST_ROOT, `workdir-${label}-`))
  created.push(dir)
  return dir
}

async function put(root, rel, content) {
  const abs = path.join(root, ...rel.split('/'))
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

async function exists(p) {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

// Stable fingerprint of a tree: relative path, type, content hash or link target.
async function hashTree(root) {
  const lines = []
  async function visit(dir, rel) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isSymbolicLink()) lines.push(`L ${r} -> ${await readlink(abs)}`)
      else if (e.isDirectory()) { lines.push(`D ${r}`); await visit(abs, r) }
      else lines.push(`F ${r} ${createHash('sha256').update(await readFile(abs)).digest('hex')}`)
    }
  }
  await visit(root, '')
  return lines.join('\n')
}

async function project() {
  const folder = await tmp('proj')
  await put(folder, 'README.md', '# hello\nline two\n')
  await put(folder, 'src/index.js', 'export const a = 1\nexport const b = 2\n')
  await put(folder, 'src/util.js', 'export const u = 3\n')
  return folder
}

after(async () => {
  for (const [p, mode] of restore) await chmod(p, mode).catch(() => {})
  for (const dir of created) await rm(dir, { recursive: true, force: true })
})

test('refuses root, home, home ancestor and system roots with the refusal reason', async () => {
  const home = await tmp('home')
  const fake = { homeDir: home }
  assert.deepEqual(
    (({ ok, code, refusal }) => ({ ok, code, refusal }))(await checkFolder('/', fake)),
    { ok: false, code: 'folder_refused', refusal: 'root' },
  )
  assert.equal((await checkFolder(home, fake)).refusal, 'home')
  assert.equal((await checkFolder('~', fake)).refusal, 'home')
  assert.equal((await checkFolder(path.dirname(home), fake)).refusal, 'home_ancestor')
  for (const root of ['/etc', '/usr/local', '/var/tmp', '/private/tmp', '/System', '/Library']) {
    const r = await checkFolder(root, fake)
    assert.equal(r.code, 'folder_refused', root)
    assert.equal(r.refusal, 'system', root)
  }
})

test('refused folders are never copied and nothing is created under baseDir', async () => {
  const home = await tmp('home2')
  const baseDir = await tmp('base-refused')
  const result = await prepareWorkdir({ runId: 'r1', folder: home, homeDir: home, baseDir })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'folder_refused')
  assert.equal(await exists(path.join(baseDir, 'runs')), false)
})

test('a symlinked folder that points at a refused location is refused', async () => {
  const home = await tmp('home3')
  const holder = await tmp('holder')
  await symlink(home, path.join(holder, 'link'))
  const r = await checkFolder(path.join(holder, 'link'), { homeDir: home })
  assert.equal(r.code, 'folder_refused')
  assert.equal(r.refusal, 'home')
})

test('failure codes: not found, not a directory, missing base', async () => {
  const dir = await tmp('codes')
  await put(dir, 'file.txt', 'x')
  assert.equal((await checkFolder(path.join(dir, 'nope'))).code, 'folder_not_found')
  assert.equal((await checkFolder(path.join(dir, 'file.txt'))).code, 'folder_not_directory')
  assert.equal((await checkFolder('relative/dir')).code, 'folder_missing_base')
  assert.equal((await checkFolder('relative/dir', { baseFolder: 'also/relative' })).code, 'folder_missing_base')
  const ok = await checkFolder('file-less', { baseFolder: dir })
  assert.equal(ok.code, 'folder_not_found')
  assert.equal(ok.resolvedFolder, path.join(dir, 'file-less'))
  for (const r of [await checkFolder(path.join(dir, 'nope'))]) assert.equal(r.reason, r.code)
})

test('a relative folder resolves against the base folder', async () => {
  const base = await tmp('rel')
  await put(base, 'proj/a.txt', 'a')
  const r = await checkFolder('proj', { baseFolder: base })
  assert.equal(r.ok, true)
  assert.equal(r.resolvedFolder, path.join(base, 'proj'))
  assert.equal(r.fileCount, 1)
})

test('folder_not_readable for a directory without read permission', { skip: process.getuid?.() === 0 }, async () => {
  const dir = await tmp('unreadable')
  await put(dir, 'a.txt', 'a')
  restore.push([dir, 0o755])
  await chmod(dir, 0o000)
  assert.equal((await checkFolder(dir)).code, 'folder_not_readable')
  await chmod(dir, 0o755)
})

test('default copy limit is 1 GB; a folder over a lowered limit is refused', async () => {
  assert.equal(DEFAULT_COPY_LIMIT_BYTES, 1024 * 1024 * 1024)
  const folder = await project()
  await put(folder, 'big.bin', 'x'.repeat(5000))
  const baseDir = await tmp('base-limit')
  assert.equal((await checkFolder(folder)).ok, true)
  const over = await checkFolder(folder, { limitBytes: 1000 })
  assert.equal(over.code, 'folder_too_large')
  const prep = await prepareWorkdir({ runId: 'big', folder, baseDir, limitBytes: 1000 })
  assert.equal(prep.code, 'folder_too_large')
  assert.equal(await exists(path.join(baseDir, 'runs')), false)
})

test('the size pre-walk uses the same filter: excluded files do not count', async () => {
  const folder = await project()
  await put(folder, 'node_modules/huge/index.js', 'x'.repeat(100000))
  await put(folder, '.env', 'SECRET=' + 'y'.repeat(100000))
  const r = await checkFolder(folder, { limitBytes: 10000 })
  assert.equal(r.ok, true)
  assert.ok(r.sizeBytes < 10000)
  assert.ok(r.excludedCount >= 2)
})

test('default exclusions list covers the documented patterns', () => {
  assert.deepEqual([...DEFAULT_EXCLUSIONS], [
    '.env*', '*.pem', '*.key', 'id_rsa*', '.npmrc', '.netrc', '.aws', '.ssh', '.gnupg',
    'credentials*', 'secrets*', 'node_modules', '.git/hooks',
  ])
})

test('copy excludes credential-like files by default', async () => {
  const folder = await project()
  const secrets = [
    '.env', '.env.local', 'server.pem', 'tls.key', 'id_rsa', 'id_rsa.pub', '.npmrc', '.netrc',
    '.aws/credentials', '.ssh/config', '.gnupg/pubring.kbx', 'credentials.json', 'secrets.yml',
    'node_modules/pkg/index.js', 'deep/node_modules/x.js', 'deep/.env', '.git/hooks/pre-commit',
  ]
  for (const rel of secrets) await put(folder, rel, 'secret')
  await put(folder, '.git/config', '[core]')
  await put(folder, 'envelope.txt', 'keep me')
  const baseDir = await tmp('base-excl')
  const prep = await prepareWorkdir({ runId: 'excl', folder, baseDir })
  assert.equal(prep.ok, true)
  for (const rel of secrets) assert.equal(await exists(path.join(prep.workDir, ...rel.split('/'))), false, rel)
  for (const rel of ['README.md', 'src/index.js', '.git/config', 'envelope.txt']) {
    assert.equal(await exists(path.join(prep.workDir, ...rel.split('/'))), true, rel)
  }
  assert.ok(prep.excludedCount > 0)
})

test('config exclusions override the defaults in both directions', async () => {
  const folder = await project()
  await put(folder, '.env', 'A=1')
  await put(folder, 'notes.private', 'p')
  const baseDir = await tmp('base-over')
  const prep = await prepareWorkdir({ runId: 'over', folder, baseDir, exclusions: ['*.private', 'src'] })
  assert.equal(prep.ok, true)
  assert.equal(await exists(path.join(prep.workDir, '.env')), true)
  assert.equal(await exists(path.join(prep.workDir, 'notes.private')), false)
  assert.equal(await exists(path.join(prep.workDir, 'src')), false)
  assert.equal(await exists(path.join(prep.workDir, 'README.md')), true)
})

test('the copy lives under <baseDir>/runs/{runId}/work and mirrors the content', async () => {
  const folder = await project()
  const baseDir = await tmp('base-copy')
  const prep = await prepareWorkdir({ runId: 'run-1', folder, baseDir })
  assert.equal(prep.ok, true)
  assert.equal(prep.workDir, path.join(baseDir, 'runs', 'run-1', 'work'))
  assert.equal(prep.runDir, path.join(baseDir, 'runs', 'run-1'))
  assert.equal(prep.fileCount, 3)
  assert.equal(await hashTree(prep.workDir), await hashTree(folder))
})

test('rejects invalid run ids and a relative baseDir', async () => {
  const folder = await project()
  const baseDir = await tmp('base-ids')
  for (const runId of ['', '..', '../x', 'a/b', undefined]) {
    assert.equal((await prepareWorkdir({ runId, folder, baseDir })).code, 'invalid_run_id', String(runId))
  }
  assert.equal((await prepareWorkdir({ runId: 'ok', folder, baseDir: 'rel/base' })).code, 'invalid_base_dir')
})

test('a baseDir inside the folder (or containing it) is refused, never written', async () => {
  const folder = await project()
  const inside = path.join(folder, 'runner-data')
  const before = await hashTree(folder)
  const r = await prepareWorkdir({ runId: 'x', folder, baseDir: inside })
  assert.equal(r.code, 'workdir_overlaps_folder')
  assert.equal(await hashTree(folder), before)
  const parent = path.dirname(folder)
  assert.equal((await prepareWorkdir({ runId: 'x', folder, baseDir: parent })).code, 'workdir_overlaps_folder')
})

test('symlinks pointing outside are neither copied nor counted; internal ones stay inside the copy', async () => {
  const folder = await project()
  const outside = await tmp('outside')
  await put(outside, 'secret.txt', 'TOP SECRET ' + 'z'.repeat(50000))
  await put(outside, 'dir/inner.txt', 'inner')
  await symlink(path.join(outside, 'secret.txt'), path.join(folder, 'link-file'))
  await symlink(path.join(outside, 'dir'), path.join(folder, 'link-dir'))
  await symlink(path.join(outside, 'nowhere'), path.join(folder, 'dangling'))
  await symlink('../../outside-rel', path.join(folder, 'src', 'rel-escape'))
  await symlink(path.join(folder, 'README.md'), path.join(folder, 'alias-abs'))
  await symlink('src/util.js', path.join(folder, 'alias-rel'))
  const outsideBefore = await hashTree(outside)

  const check = await checkFolder(folder, { limitBytes: 2000 })
  assert.equal(check.ok, true, 'outside content must not count toward the size')

  const baseDir = await tmp('base-sym')
  const prep = await prepareWorkdir({ runId: 'sym', folder, baseDir, limitBytes: 2000 })
  assert.equal(prep.ok, true)
  for (const name of ['link-file', 'link-dir', 'dangling', 'src/rel-escape']) {
    assert.equal(await exists(path.join(prep.workDir, ...name.split('/'))), false, name)
  }
  assert.equal(prep.skippedSymlinks, 4)
  for (const name of ['alias-abs', 'alias-rel']) {
    const target = await readlink(path.join(prep.workDir, name))
    assert.equal(path.isAbsolute(target), false, `${name} must be relative`)
    const resolved = path.resolve(prep.workDir, target)
    assert.ok(resolved.startsWith(prep.workDir + path.sep), `${name} stays inside the copy`)
  }
  assert.equal(await readFile(path.join(prep.workDir, 'alias-rel'), 'utf8'), 'export const u = 3\n')
  assert.equal(await hashTree(outside), outsideBefore)
})

test('a symlink to an excluded file is not recreated', async () => {
  const folder = await project()
  await put(folder, '.env', 'A=1')
  await symlink('.env', path.join(folder, 'innocent-name'))
  const prep = await prepareWorkdir({ runId: 'sx', folder, baseDir: await tmp('base-sx') })
  assert.equal(prep.ok, true)
  assert.equal(await exists(path.join(prep.workDir, 'innocent-name')), false)
  assert.equal(await exists(path.join(prep.workDir, '.env')), false)
})

test('the original folder is byte-identical after prepare, edits in the copy, diff and clean', async () => {
  const folder = await project()
  await put(folder, '.env', 'KEEP=1')
  const outside = await tmp('outside2')
  await symlink(outside, path.join(folder, 'out'))
  const before = await hashTree(folder)
  const baseDir = await tmp('base-ident')
  const prep = await prepareWorkdir({ runId: 'ident', folder, baseDir })
  assert.equal(prep.ok, true)
  await writeFile(path.join(prep.workDir, 'README.md'), 'changed in copy\n')
  await rm(path.join(prep.workDir, 'src', 'util.js'))
  await put(prep.workDir, 'new.txt', 'new')
  const diff = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.equal(diff.changed.length, 1)
  assert.equal(await hashTree(folder), before)
  assert.equal((await cleanWorkdir({ runId: 'ident', baseDir })).ok, true)
  assert.equal(await hashTree(folder), before)
})

test('diff lists changed, added and removed files with a unified diff', async () => {
  const folder = await project()
  const prep = await prepareWorkdir({ runId: 'd1', folder, baseDir: await tmp('base-diff') })
  await writeFile(path.join(prep.workDir, 'src/index.js'), 'export const a = 1\nexport const b = 22\nexport const c = 3\n')
  await rm(path.join(prep.workDir, 'src/util.js'))
  await put(prep.workDir, 'docs/new.md', 'brand new\n')
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.deepEqual(d.changed, ['src/index.js'])
  assert.deepEqual(d.added, ['docs/new.md'])
  assert.deepEqual(d.removed, ['src/util.js'])
  assert.equal(d.truncated, false)
  assert.match(d.diff, /--- a\/src\/index\.js\n\+\+\+ b\/src\/index\.js\n@@ -1,2 \+1,3 @@\n export const a = 1\n-export const b = 2\n\+export const b = 22\n\+export const c = 3\n/)
  assert.match(d.diff, /--- \/dev\/null\n\+\+\+ b\/docs\/new\.md\n@@ -0,0 \+1 @@\n\+brand new\n/)
  assert.match(d.diff, /--- a\/src\/util\.js\n\+\+\+ \/dev\/null\n@@ -1 \+0,0 @@\n-export const u = 3\n/)
})

test('diff of an untouched copy is empty', async () => {
  const folder = await project()
  const prep = await prepareWorkdir({ runId: 'd0', folder, baseDir: await tmp('base-d0') })
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.deepEqual([d.changed, d.added, d.removed, d.diff, d.truncated], [[], [], [], '', false])
})

test('diff reports a missing final newline, binary files and ignores excluded files created in the copy', async () => {
  const folder = await project()
  await writeFile(path.join(folder, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  const prep = await prepareWorkdir({ runId: 'd2', folder, baseDir: await tmp('base-d2') })
  await writeFile(path.join(prep.workDir, 'README.md'), '# hello\nline two')
  await writeFile(path.join(prep.workDir, 'bin.dat'), Buffer.from([0, 9, 9, 9]))
  await put(prep.workDir, 'node_modules/x/index.js', 'noise')
  await put(prep.workDir, '.env', 'created by tool')
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.deepEqual(d.changed, ['README.md', 'bin.dat'])
  assert.deepEqual(d.added, [])
  assert.match(d.diff, /-line two\n\+line two\n\\ No newline at end of file\n/)
  assert.match(d.diff, /Binary files a\/bin\.dat and b\/bin\.dat differ/)
})

test('the unified diff is capped (default 256 KB) with an explicit marker', async () => {
  const folder = await project()
  const prep = await prepareWorkdir({ runId: 'd3', folder, baseDir: await tmp('base-d3') })
  for (let i = 0; i < 20; i++) await put(prep.workDir, `gen/f${i}.txt`, `${'é'.repeat(5000)}\n`.repeat(20))
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.equal(d.truncated, true)
  assert.equal(d.added.length, 20)
  assert.ok(Buffer.byteLength(d.diff) <= 256 * 1024)
  assert.match(d.diff, /diff truncated at 262144 bytes/)
  assert.equal(d.diff.includes('�'), false)
  const small = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir, maxDiffBytes: 500 })
  assert.ok(Buffer.byteLength(small.diff) <= 500)
  assert.equal(small.truncated, true)
})

test('clean removes the copy, tolerates a missing one and can remove the run directory', async () => {
  const folder = await project()
  const baseDir = await tmp('base-clean')
  const prep = await prepareWorkdir({ runId: 'c1', folder, baseDir })
  await put(prep.runDir, 'output.log', 'log')
  const r = await cleanWorkdir({ runId: 'c1', baseDir })
  assert.deepEqual([r.ok, r.removed, r.path], [true, true, prep.workDir])
  assert.equal(await exists(prep.workDir), false)
  assert.equal(await exists(path.join(prep.runDir, 'output.log')), true)
  assert.equal((await cleanWorkdir({ runId: 'c1', baseDir })).removed, false)
  const all = await cleanWorkdir({ runId: 'c1', baseDir, removeRunDir: true })
  assert.equal(all.removed, true)
  assert.equal(await exists(prep.runDir), false)
  assert.equal(await exists(folder), true)
  assert.equal((await cleanWorkdir({ runId: '../escape', baseDir })).code, 'invalid_run_id')
})

test('clean does not follow a symlink placed inside the copy', async () => {
  const folder = await project()
  const baseDir = await tmp('base-cleansym')
  const prep = await prepareWorkdir({ runId: 'c2', folder, baseDir })
  const victim = await tmp('victim')
  await put(victim, 'keep.txt', 'keep')
  await symlink(victim, path.join(prep.workDir, 'evil'))
  await cleanWorkdir({ runId: 'c2', baseDir })
  assert.equal(await readFile(path.join(victim, 'keep.txt'), 'utf8'), 'keep')
})

test('preparing the same runId twice replaces the previous copy', async () => {
  const folder = await project()
  const baseDir = await tmp('base-twice')
  const first = await prepareWorkdir({ runId: 't', folder, baseDir })
  await put(first.workDir, 'leftover.txt', 'old')
  const second = await prepareWorkdir({ runId: 't', folder, baseDir })
  assert.equal(second.ok, true)
  assert.equal(await exists(path.join(second.workDir, 'leftover.txt')), false)
})

// ---- ideas without a working folder (FR-017): an empty scratch directory, nothing from the user's disk

test('no folder is not an error: checkFolder reports an empty scratch run with no resolved folder', async () => {
  for (const input of ['', '   ', null, undefined]) {
    const r = await checkFolder(input, { baseFolder: '/base', homeDir: '/home/u' })
    assert.equal(r.ok, true, JSON.stringify(input))
    assert.equal(r.resolvedFolder, null)
    assert.equal(r.scratch, true)
    assert.equal(r.fileCount, 0)
    assert.equal(r.sizeBytes, 0)
  }
})

test('a relative folder without a base folder is still an error, never treated as no folder', async () => {
  const r = await checkFolder('proj')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'folder_missing_base')
  assert.equal((await prepareWorkdir({ runId: 'r-rel', folder: 'proj', baseDir: await tmp('base-rel') })).code, 'folder_missing_base')
})

test('a folder-less run gets an EMPTY scratch directory under runs/{runId}/work and copies nothing', async () => {
  const baseDir = await tmp('scratch-base')
  const homeDir = await tmp('scratch-home')
  await put(homeDir, 'secret.txt', 'must never be copied')
  await put(baseDir, 'approvals.json', '{}')
  const r = await prepareWorkdir({ runId: 'run-s', folder: null, homeDir, baseDir })
  assert.equal(r.ok, true)
  assert.equal(r.scratch, true)
  assert.equal(r.originalDir, null)
  assert.equal(r.resolvedFolder, null)
  assert.equal(r.workDir, path.join(baseDir, 'runs', 'run-s', 'work'))
  assert.equal(r.runDir, path.join(baseDir, 'runs', 'run-s'))
  assert.equal(r.fileCount, 0)
  assert.equal(r.sizeBytes, 0)
  assert.deepEqual(await readdir(r.workDir), [])
  assert.deepEqual(await readdir(path.join(baseDir, 'runs')), ['run-s'])
  assert.equal((await lstat(r.workDir)).mode & 0o777, 0o700)
  // a second run of the same id starts empty again
  await put(r.workDir, 'left-over.txt', 'x')
  const again = await prepareWorkdir({ runId: 'run-s', folder: '', baseDir })
  assert.deepEqual(await readdir(again.workDir), [])
})

test('a folder-less run still needs a valid run id and an absolute base directory', async () => {
  assert.equal((await prepareWorkdir({ runId: '../x', folder: null, baseDir: await tmp('scratch-id') })).code, 'invalid_run_id')
  assert.equal((await prepareWorkdir({ runId: 'ok', folder: null, baseDir: 'relative/base' })).code, 'invalid_base_dir')
})

test('the diff of a scratch run lists every file the tool created as added', async () => {
  const baseDir = await tmp('scratch-diff')
  const r = await prepareWorkdir({ runId: 'run-d', folder: null, baseDir })
  const empty = await diffWorkdir({ originalDir: r.originalDir, workDir: r.workDir })
  assert.deepEqual([empty.changed, empty.added, empty.removed, empty.diff], [[], [], [], ''])
  await put(r.workDir, 'notes/draft.md', 'first line\nsecond line\n')
  await put(r.workDir, 'summary.txt', 'done\n')
  const d = await diffWorkdir({ originalDir: r.originalDir, workDir: r.workDir })
  assert.deepEqual(d.added, ['notes/draft.md', 'summary.txt'])
  assert.deepEqual(d.changed, [])
  assert.deepEqual(d.removed, [])
  assert.match(d.diff, /--- \/dev\/null\n\+\+\+ b\/notes\/draft\.md\n/)
  assert.match(d.diff, /\+first line/)
})
