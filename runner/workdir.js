// Disposable working copy of an idea's folder (FR-016, FR-017, FR-030; research D10).
// Node built-ins only. The original folder is only ever read: every write goes under
// `<baseDir>/runs/{runId}/`, and symlinks are never followed (a symlink that leaves the folder is dropped).

import { constants as fsc } from 'node:fs'
import { access, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { classifyFolder, refusedLocationReason, resolveFolder } from '../src/surplus/paths.js'

export const DEFAULT_COPY_LIMIT_BYTES = 1024 * 1024 * 1024
export const DEFAULT_DIFF_CAP_BYTES = 256 * 1024
export const DEFAULT_EXCLUSIONS = Object.freeze([
  '.env*', '*.pem', '*.key', 'id_rsa*', '.npmrc', '.netrc', '.aws', '.ssh', '.gnupg',
  'credentials*', 'secrets*', 'node_modules', '.git/hooks',
])

const MAX_DIFF_FILE_BYTES = 1024 * 1024
const MAX_LCS_CELLS = 4_000_000
const CONTEXT_LINES = 3
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function defaultBaseDir() {
  return path.join(homedir(), '.kairos-runner')
}

/** The configured exclusion list when it is an array of strings, else the defaults. */
export function normalizeExclusions(list) {
  if (!Array.isArray(list)) return [...DEFAULT_EXCLUSIONS]
  return list.filter((p) => typeof p === 'string' && p.trim() !== '').map((p) => p.trim().replace(/\/+$/, '')).filter(Boolean)
}

function globToRegExp(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  return new RegExp(`^${body}$`, 'i')
}

/** Compile exclusion patterns: no `/` matches an entry name at any depth, with `/` the relative path. */
function compileExclusions(list) {
  const names = []
  const paths = []
  for (const p of normalizeExclusions(list)) (p.includes('/') ? paths : names).push(globToRegExp(p.replace(/^\.?\//, '')))
  return (rel, name) => names.some((re) => re.test(name)) || paths.some((re) => re.test(rel))
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/** Realpath of the nearest existing ancestor plus the missing tail (never creates anything). */
async function realpathLoose(p) {
  const tail = []
  let current = path.resolve(p)
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.join(current, ...tail)
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Walk `root` without following symlinks, applying the exclusion filter.
 * Returns regular files, directories and symlinks (relative POSIX paths) plus counters.
 * Stops early once `limitBytes` is exceeded (`overLimit`).
 */
async function walkTree(root, isExcluded, { limitBytes = Infinity } = {}) {
  const out = { files: [], dirs: [], symlinks: [], bytes: 0, excluded: 0, unreadable: 0, overLimit: false }
  async function visit(absDir, relDir) {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch (err) {
      if (relDir === '') throw err
      out.unreadable += 1
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (out.overLimit) return
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (isExcluded(rel, entry.name)) {
        out.excluded += 1
        continue
      }
      const abs = path.join(absDir, entry.name)
      if (entry.isSymbolicLink()) {
        out.symlinks.push({ rel, abs })
      } else if (entry.isDirectory()) {
        out.dirs.push(rel)
        await visit(abs, rel)
      } else if (entry.isFile()) {
        let st
        try {
          st = await lstat(abs)
        } catch {
          out.unreadable += 1
          continue
        }
        out.files.push({ rel, abs, size: st.size, mode: st.mode })
        out.bytes += st.size
        if (out.bytes > limitBytes) out.overLimit = true
      }
      // sockets, FIFOs and devices are never copied
    }
  }
  await visit(root, '')
  return out
}

function failure(code, extra = {}) {
  return { ok: false, code, reason: code, ...extra }
}

/**
 * Local folder check (exists, readable, not refused, size under limit).
 * Result shape matches `folderChecks[ideaId]`: `{ ok, code?, resolvedFolder?, sizeBytes?, fileCount? }`.
 * An empty or missing folder (FR-017) is not an error: the idea runs in an empty scratch directory with no
 * project files, reported as `{ ok: true, resolvedFolder: null, scratch: true, sizeBytes: 0, fileCount: 0 }`.
 * A relative folder without a base folder is NOT empty: it stays a `folder_missing_base` error.
 * Codes: folder_missing_base, folder_missing_home, folder_refused (+ `refusal`),
 * folder_not_found, folder_not_directory, folder_not_readable, folder_too_large.
 * Never writes anything.
 */
export async function checkFolder(folder, options = {}) {
  const { baseFolder, homeDir = homedir(), exclusions, limitBytes = DEFAULT_COPY_LIMIT_BYTES } = options
  if (classifyFolder(folder) === 'empty') {
    return { ok: true, resolvedFolder: null, realFolder: null, scratch: true, sizeBytes: 0, fileCount: 0, excludedCount: 0, limitBytes }
  }
  const resolved = resolveFolder(folder, baseFolder, homeDir)
  if (typeof resolved !== 'string') return failure(resolved.error)
  const refusal = refusedLocationReason(resolved, homeDir)
  if (refusal) return failure('folder_refused', { refusal, resolvedFolder: resolved })

  let st
  try {
    st = await lstat(resolved)
  } catch (err) {
    return failure(err.code === 'EACCES' ? 'folder_not_readable' : 'folder_not_found', { resolvedFolder: resolved })
  }
  let real = resolved
  if (st.isSymbolicLink()) {
    // A symlinked root is followed once, but the target must itself be an allowed location.
    try {
      real = await realpath(resolved)
      st = await lstat(real)
    } catch {
      return failure('folder_not_found', { resolvedFolder: resolved })
    }
    const realRefusal = refusedLocationReason(real, homeDir)
    if (realRefusal) return failure('folder_refused', { refusal: realRefusal, resolvedFolder: resolved })
  } else {
    try {
      real = await realpath(resolved)
    } catch {
      return failure('folder_not_found', { resolvedFolder: resolved })
    }
    const realRefusal = refusedLocationReason(real, homeDir)
    if (realRefusal) return failure('folder_refused', { refusal: realRefusal, resolvedFolder: resolved })
  }
  if (!st.isDirectory()) return failure('folder_not_directory', { resolvedFolder: resolved })
  try {
    await access(real, fsc.R_OK | fsc.X_OK)
  } catch {
    return failure('folder_not_readable', { resolvedFolder: resolved })
  }

  let tree
  try {
    tree = await walkTree(real, compileExclusions(exclusions), { limitBytes })
  } catch {
    return failure('folder_not_readable', { resolvedFolder: resolved })
  }
  if (tree.overLimit) return failure('folder_too_large', { resolvedFolder: resolved, limitBytes })
  return { ok: true, resolvedFolder: resolved, realFolder: real, sizeBytes: tree.bytes, fileCount: tree.files.length, excludedCount: tree.excluded, limitBytes }
}

function runPaths(baseDir, runId) {
  const runDir = path.join(baseDir, 'runs', runId)
  return { runDir, workDir: path.join(runDir, 'work') }
}

function validRunId(runId) {
  return typeof runId === 'string' && RUN_ID_RE.test(runId) && runId !== '.' && runId !== '..'
}

/**
 * Create the disposable copy under `<baseDir>/runs/{runId}/work`.
 * Without a working folder (empty input) the directory is created EMPTY: nothing is copied and nothing
 * from the user's disk is read; the result has `scratch: true`, `originalDir: null`, `resolvedFolder: null`.
 * options: { runId, folder, baseFolder?, homeDir?, baseDir? (default ~/.kairos-runner), exclusions?, limitBytes? }
 * Success: { ok: true, runId, runDir, workDir, originalDir (real path), resolvedFolder, sizeBytes, fileCount,
 *            excludedCount, skippedSymlinks }
 * Failure: { ok: false, code, reason, ... } with the checkFolder codes, plus invalid_run_id, invalid_base_dir,
 *          workdir_overlaps_folder, copy_failed.
 */
export async function prepareWorkdir(options = {}) {
  const { runId, folder, baseFolder, homeDir = homedir(), baseDir = defaultBaseDir(), exclusions, limitBytes } = options
  if (!validRunId(runId)) return failure('invalid_run_id')
  if (typeof baseDir !== 'string' || !path.isAbsolute(baseDir)) return failure('invalid_base_dir')

  const check = await checkFolder(folder, { baseFolder, homeDir, exclusions, limitBytes })
  if (!check.ok) return check
  const original = check.realFolder
  const { runDir, workDir } = runPaths(path.resolve(baseDir), runId)

  if (check.scratch) {
    try {
      await rm(runDir, { recursive: true, force: true })
      await mkdir(workDir, { recursive: true, mode: 0o700 })
      return {
        ok: true, runId, runDir, workDir, originalDir: null, resolvedFolder: null, scratch: true,
        sizeBytes: 0, fileCount: 0, excludedCount: 0, skippedSymlinks: 0,
      }
    } catch (err) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {})
      return failure('copy_failed', { resolvedFolder: null, message: err.message })
    }
  }

  // The copy must never land inside the original (that would write to it), nor the original inside the runner dir.
  const realBase = await realpathLoose(baseDir)
  if (isInside(realBase, original) || isInside(original, realBase)) {
    return failure('workdir_overlaps_folder', { resolvedFolder: check.resolvedFolder })
  }

  const isExcluded = compileExclusions(exclusions)
  let tree
  try {
    tree = await walkTree(original, isExcluded, { limitBytes: limitBytes ?? DEFAULT_COPY_LIMIT_BYTES })
    if (tree.overLimit) return failure('folder_too_large', { resolvedFolder: check.resolvedFolder })
    await rm(runDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true, mode: 0o700 })
    for (const rel of tree.dirs) await mkdir(path.join(workDir, ...rel.split('/')), { recursive: true })
    for (const file of tree.files) {
      const target = path.join(workDir, ...file.rel.split('/'))
      await copyFile(file.abs, target, fsc.COPYFILE_EXCL)
    }
    const skippedSymlinks = await copySafeSymlinks(tree.symlinks, original, workDir, isExcluded)
    return {
      ok: true, runId, runDir, workDir, originalDir: original, resolvedFolder: check.resolvedFolder,
      sizeBytes: tree.bytes, fileCount: tree.files.length, excludedCount: tree.excluded, skippedSymlinks,
    }
  } catch (err) {
    await rm(runDir, { recursive: true, force: true }).catch(() => {})
    return failure('copy_failed', { resolvedFolder: check.resolvedFolder, message: err.message })
  }
}

/**
 * Re-create symlinks whose real target is inside the original folder (and not excluded) as relative
 * links inside the copy. Everything else (outside, dangling, excluded target) is dropped. Returns the dropped count.
 */
async function copySafeSymlinks(symlinks, original, workDir, isExcluded) {
  let skipped = 0
  for (const link of symlinks) {
    try {
      const real = await realpath(link.abs)
      if (!isInside(real, original) || real === original) throw new Error('outside')
      const relTarget = toPosix(path.relative(original, real))
      const segments = relTarget.split('/')
      if (segments.some((seg, i) => isExcluded(segments.slice(0, i + 1).join('/'), seg))) throw new Error('excluded')
      const linkPath = path.join(workDir, ...link.rel.split('/'))
      const targetInCopy = path.join(workDir, ...segments)
      await symlink(path.relative(path.dirname(linkPath), targetInCopy), linkPath)
    } catch {
      skipped += 1
    }
  }
  return skipped
}

// ---------------------------------------------------------------- diff

function splitLines(text) {
  const lines = text.split('\n')
  let noEol = false
  if (lines[lines.length - 1] === '') lines.pop()
  else noEol = true
  // Encode a missing final newline in the last line so it compares as different.
  if (noEol && lines.length > 0) lines[lines.length - 1] += '\u0000'
  return lines
}

/** Edit script [{ t: ' ' | '-' | '+', line }] between two line arrays (prefix/suffix trim + LCS). */
function editScript(a, b) {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const ops = []
  for (let i = 0; i < start; i++) ops.push({ t: ' ', line: a[i] })
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_LCS_CELLS) {
    for (let i = start; i < endA; i++) ops.push({ t: '-', line: a[i] })
    for (let j = start; j < endB; j++) ops.push({ t: '+', line: b[j] })
  } else {
    const w = m + 1
    const table = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = a[start + i] === b[start + j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) { ops.push({ t: ' ', line: a[start + i] }); i++; j++ }
      else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) { ops.push({ t: '-', line: a[start + i] }); i++ }
      else { ops.push({ t: '+', line: b[start + j] }); j++ }
    }
    while (i < n) { ops.push({ t: '-', line: a[start + i] }); i++ }
    while (j < m) { ops.push({ t: '+', line: b[start + j] }); j++ }
  }
  for (let i = endA; i < a.length; i++) ops.push({ t: ' ', line: a[i] })
  return ops
}

function formatLine(prefix, line) {
  return line.endsWith('\u0000') ? `${prefix}${line.slice(0, -1)}\n\\ No newline at end of file\n` : `${prefix}${line}\n`
}

function hunkRange(start, count) {
  return count === 1 ? `${start}` : `${start},${count}`
}

function unifiedHunks(a, b) {
  const ops = editScript(a, b)
  const changeIdx = []
  ops.forEach((op, i) => { if (op.t !== ' ') changeIdx.push(i) })
  if (changeIdx.length === 0) return ''
  const groups = []
  let from = Math.max(0, changeIdx[0] - CONTEXT_LINES)
  let to = Math.min(ops.length, changeIdx[0] + CONTEXT_LINES + 1)
  for (const idx of changeIdx.slice(1)) {
    if (idx - CONTEXT_LINES <= to) to = Math.min(ops.length, idx + CONTEXT_LINES + 1)
    else { groups.push([from, to]); from = Math.max(0, idx - CONTEXT_LINES); to = Math.min(ops.length, idx + CONTEXT_LINES + 1) }
  }
  groups.push([from, to])
  let out = ''
  for (const [s, e] of groups) {
    let oldStart = 1
    let newStart = 1
    for (let i = 0; i < s; i++) { if (ops[i].t !== '+') oldStart++; if (ops[i].t !== '-') newStart++ }
    let oldCount = 0
    let newCount = 0
    let body = ''
    for (let i = s; i < e; i++) {
      const op = ops[i]
      if (op.t !== '+') oldCount++
      if (op.t !== '-') newCount++
      body += formatLine(op.t, op.line)
    }
    out += `@@ -${hunkRange(oldCount === 0 ? oldStart - 1 : oldStart, oldCount)} +${hunkRange(newCount === 0 ? newStart - 1 : newStart, newCount)} @@\n${body}`
  }
  return out
}

function isBinary(buf) {
  return buf.includes(0)
}

function fileDiff(rel, oldBuf, newBuf) {
  const oldName = oldBuf ? `a/${rel}` : '/dev/null'
  const newName = newBuf ? `b/${rel}` : '/dev/null'
  const head = `diff --kairos ${rel}\n--- ${oldName}\n+++ ${newName}\n`
  const tooBig = (oldBuf?.length ?? 0) > MAX_DIFF_FILE_BYTES || (newBuf?.length ?? 0) > MAX_DIFF_FILE_BYTES
  if ((oldBuf && isBinary(oldBuf)) || (newBuf && isBinary(newBuf))) return `diff --kairos ${rel}\nBinary files ${oldName} and ${newName} differ\n`
  if (tooBig) return `diff --kairos ${rel}\nFiles ${oldName} and ${newName} differ (too large to show)\n`
  const a = oldBuf ? splitLines(oldBuf.toString('utf8')) : []
  const b = newBuf ? splitLines(newBuf.toString('utf8')) : []
  const hunks = unifiedHunks(a, b)
  return hunks === '' ? '' : head + hunks
}

function capText(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false }
  const marker = `\n... diff truncated at ${maxBytes} bytes ...\n`
  const keep = Math.max(0, maxBytes - Buffer.byteLength(marker))
  const cut = buf.subarray(0, keep).toString('utf8').replace(/�+$/, '')
  return { text: cut + marker, truncated: true }
}

async function readIfFile(abs) {
  try {
    return await readFile(abs)
  } catch {
    return null
  }
}

/**
 * Read-only comparison of the copy against the original, with the same exclusion filter on both sides
 * (symlinks are ignored). A null `originalDir` (scratch run without a working folder) compares against an empty
 * tree, so every file the tool created is `added`. options: { originalDir, workDir, exclusions?, maxDiffBytes? (default 256 KB) }
 * Returns { changed: [rel], added: [rel], removed: [rel], diff: string, truncated: boolean }.
 * Nothing is written, in either folder.
 */
export async function diffWorkdir(options = {}) {
  const { originalDir, workDir, exclusions, maxDiffBytes = DEFAULT_DIFF_CAP_BYTES } = options
  const isExcluded = compileExclusions(exclusions)
  const noOriginal = originalDir === null || originalDir === undefined
  const emptyTree = { files: [], dirs: [], symlinks: [], bytes: 0, excluded: 0, unreadable: 0, overLimit: false }
  const [orig, work] = await Promise.all([noOriginal ? emptyTree : walkTree(originalDir, isExcluded), walkTree(workDir, isExcluded)])
  const origMap = new Map(orig.files.map((f) => [f.rel, f]))
  const workMap = new Map(work.files.map((f) => [f.rel, f]))
  const changed = []
  const added = []
  const removed = []
  for (const [rel, f] of workMap) {
    const o = origMap.get(rel)
    if (!o) { added.push(rel); continue }
    if (o.size !== f.size) { changed.push(rel); continue }
    const [x, y] = await Promise.all([readIfFile(o.abs), readIfFile(f.abs)])
    if (!x || !y || !x.equals(y)) changed.push(rel)
  }
  for (const rel of origMap.keys()) if (!workMap.has(rel)) removed.push(rel)
  changed.sort(); added.sort(); removed.sort()

  const all = [...changed.map((r) => [r, 'c']), ...added.map((r) => [r, 'a']), ...removed.map((r) => [r, 'r'])].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
  let diff = ''
  let size = 0
  for (const [rel, kind] of all) {
    const oldBuf = kind === 'a' ? null : await readIfFile(origMap.get(rel).abs)
    const newBuf = kind === 'r' ? null : await readIfFile(workMap.get(rel).abs)
    const part = fileDiff(rel, oldBuf, newBuf)
    diff += part
    size += Buffer.byteLength(part)
    if (size > maxDiffBytes) break
  }
  const capped = capText(diff, maxDiffBytes)
  return { changed, added, removed, diff: capped.text, truncated: capped.truncated }
}

/**
 * Remove the disposable copy `<baseDir>/runs/{runId}/work` (or the whole run directory with
 * `{ removeRunDir: true }`). Symlinks inside are removed, never followed. Returns { ok, removed, path }.
 */
export async function cleanWorkdir(options = {}) {
  const { runId, baseDir = defaultBaseDir(), removeRunDir = false } = options
  if (!validRunId(runId)) return failure('invalid_run_id')
  if (typeof baseDir !== 'string' || !path.isAbsolute(baseDir)) return failure('invalid_base_dir')
  const { runDir, workDir } = runPaths(path.resolve(baseDir), runId)
  const target = removeRunDir ? runDir : workDir
  let existed = true
  try {
    await lstat(target)
  } catch {
    existed = false
  }
  if (existed) {
    // Make read-only trees removable (rm needs write permission on directories).
    await rm(target, { recursive: true, force: true, maxRetries: 2 })
  }
  return { ok: true, removed: existed, path: target }
}
