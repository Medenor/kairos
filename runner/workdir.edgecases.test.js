// T072: the proposal diff is capped in UTF-8 bytes (256 KB by default) without cutting a character in two.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { diffWorkdir, prepareWorkdir } from './workdir.js'

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')
const created = []
after(async () => { for (const dir of created) await rm(dir, { recursive: true, force: true }) })

async function tmp(label) {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(path.join(TEST_ROOT, `workdir-edge-${label}-`))
  created.push(dir)
  return dir
}

async function prepared(label) {
  const folder = await tmp(`${label}-src`)
  await writeFile(path.join(folder, 'README.md'), 'hello\n')
  const prep = await prepareWorkdir({ runId: `edge-${label}`, folder, baseDir: await tmp(`${label}-base`) })
  assert.equal(prep.ok, true)
  return prep
}

test('a diff over 256 KB of multi-byte text is cut in bytes, on a character boundary, with a marker', async () => {
  const prep = await prepared('big')
  const line = `${'€'.repeat(40)}😀é\n`
  await writeFile(path.join(prep.workDir, 'big.txt'), line.repeat(8000)) // about 800 KB, under the per-file limit
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.equal(d.truncated, true)
  assert.ok(Buffer.byteLength(d.diff) <= 256 * 1024, `${Buffer.byteLength(d.diff)} bytes`)
  assert.ok(Buffer.byteLength(d.diff) > 256 * 1024 - 200, 'keeps almost the whole budget')
  assert.ok(!d.diff.includes('�'))
  assert.match(d.diff, /\.\.\. diff truncated at 262144 bytes \.\.\.\n$/)
})

test('whatever the byte budget, a truncated diff stays valid text within the budget', async () => {
  const prep = await prepared('budget')
  await writeFile(path.join(prep.workDir, 'wide.txt'), `${'€😀é'.repeat(2000)}\n`)
  for (let budget = 300; budget < 312; budget += 1) {
    const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir, maxDiffBytes: budget })
    assert.equal(d.truncated, true, `budget ${budget}`)
    assert.ok(Buffer.byteLength(d.diff) <= budget, `budget ${budget}: ${Buffer.byteLength(d.diff)}`)
    assert.ok(!d.diff.includes('�'), `budget ${budget}`)
  }
})

test('a small diff is not truncated', async () => {
  const prep = await prepared('small')
  await writeFile(path.join(prep.workDir, 'README.md'), 'héllo €\n')
  const d = await diffWorkdir({ originalDir: prep.originalDir, workDir: prep.workDir })
  assert.equal(d.truncated, false)
  assert.match(d.diff, /\+héllo €/)
})
