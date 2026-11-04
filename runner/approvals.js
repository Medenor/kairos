// Local approvals (FR-013, FR-029, research D7).
//
// The ONLY source of truth for "this idea may run automatically" is the file
// `<baseDir>/approvals.json`, written by the `approve` terminal prompt on the runner device.
// Nothing from the shared store (the `approvalRequested` flag, a lease `approved` map, a hash or
// `approved` field planted on an idea) is ever read for authorisation: `isApproved` looks at the
// idea only to compute its content hash and at the local file for the stored hash.
//
// Canonicalisation (what is hashed):
//   content = { text, context, resolvedFolder }
//     text           the idea text, unchanged (must be a non-empty string)
//     context        the context information, unchanged; undefined/null is treated as ''
//     resolvedFolder the absolute folder the run would copy (the caller resolves it; a non-empty
//                    string), or null for an idea WITHOUT a working folder (FR-017): that run happens
//                    in an empty scratch directory, so the hash is of {text, context, resolvedFolder: null}.
//                    Only an explicit null means that: '' and undefined are invalid (a caller bug must
//                    not silently become "no folder"). An idea that gains a folder later, or loses it,
//                    hashes differently and must be approved again.
//   canonical JSON = JSON.stringify of the content where every object's keys are sorted by code
//                    point, recursively, with no whitespace. Strings are escaped by JSON.stringify.
//   hash           = lower-case hex SHA-256 of the UTF-8 bytes of the canonical JSON.
// Editing any of the three fields changes the hash, so the approval is withdrawn automatically.
// Other idea fields (id, priority, size, contentVersion, ...) are not part of the hash.
//
// File format: { [ideaId]: { hash, approvedAt, preview } }, mode 0600 in a 0700 directory.

import { createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

export const APPROVALS_FILE = 'approvals.json'
export const DEFAULT_BASE_DIR = path.join(os.homedir(), '.kairos-runner')
const PREVIEW_CHARS = 80
export const NO_FOLDER_NOTICE = 'No working folder: this idea runs in an empty scratch directory with no project files'
const HASH_PATTERN = /^[0-9a-f]{64}$/

/** JSON with recursively sorted object keys and no whitespace. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function approvalContent(idea, resolvedFolder) {
  if (idea === null || typeof idea !== 'object') return null
  if (typeof idea.text !== 'string' || idea.text === '') return null
  if (resolvedFolder !== null && (typeof resolvedFolder !== 'string' || resolvedFolder === '')) return null
  const context = idea.context === undefined || idea.context === null ? '' : idea.context
  if (typeof context !== 'string') return null
  return { text: idea.text, context, resolvedFolder }
}

/** SHA-256 hex of the canonical JSON of {text, context, resolvedFolder} (folder null: no working folder), or null for invalid input. */
export function approvalHash(idea, resolvedFolder) {
  const content = approvalContent(idea, resolvedFolder)
  if (content === null) return null
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')
}

function filePath(baseDir) {
  return path.join(baseDir ?? DEFAULT_BASE_DIR, APPROVALS_FILE)
}

// Reads the local file. Missing file -> {}. Unreadable or malformed -> throws (callers that
// authorise catch it and fail closed).
function readStore(baseDir) {
  let raw
  try {
    raw = fs.readFileSync(filePath(baseDir), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
  const parsed = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('approvals file is not an object')
  return parsed
}

function writeStore(baseDir, store) {
  const dir = baseDir ?? DEFAULT_BASE_DIR
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
  const target = filePath(baseDir)
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, target)
}

function storedHash(store, ideaId) {
  if (typeof ideaId !== 'string' || !Object.hasOwn(store, ideaId)) return null
  const entry = store[ideaId]
  if (entry === null || typeof entry !== 'object' || typeof entry.hash !== 'string' || !HASH_PATTERN.test(entry.hash)) return null
  return entry.hash
}

function sameHash(a, b) {
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * True only when the local approvals file holds, for idea.id, the hash of the idea's current
 * {text, context, resolvedFolder}. Reads nothing else: shared-store flags and maps are ignored.
 * Fails closed (false) on a missing, corrupt or malformed file.
 * options: { baseDir } (default ~/.kairos-runner).
 */
export function isApproved(idea, resolvedFolder, options = {}) {
  try {
    const hash = approvalHash(idea, resolvedFolder)
    if (hash === null) return false
    const stored = storedHash(readStore(options.baseDir), idea.id)
    return stored !== null && sameHash(stored, hash)
  } catch {
    return false
  }
}

/**
 * Line-based prompter over injectable streams. `ask(question)` prints the question and resolves
 * with the next line, or '' when the input has closed. Queues lines so several questions can
 * share one piped stream. Call `close()` when done.
 */
export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, terminal: false })
  const lines = []
  const waiting = []
  let closed = false
  rl.on('line', (line) => {
    const next = waiting.shift()
    if (next) next(line)
    else lines.push(line)
  })
  rl.on('close', () => {
    closed = true
    while (waiting.length > 0) waiting.shift()('')
  })
  return {
    write(text) {
      output.write(text)
    },
    ask(question) {
      output.write(question)
      if (lines.length > 0) return Promise.resolve(lines.shift())
      if (closed) return Promise.resolve('')
      return new Promise((resolve) => waiting.push(resolve))
    },
    close() {
      rl.close()
    },
  }
}

function previewOf(text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

/**
 * Interactive approval of one idea on the runner device. Prints the exact text, context, resolved
 * folder and exclusion list, then requires the answer `yes` (case-sensitive, trimmed). Any other
 * answer, or a closed input, approves nothing. For an idea without a folder `resolvedFolder` is null and
 * a notice replaces the folder and the exclusions.
 * options: { baseDir, now (ISO string, required), exclusions (string[]), input, output | prompter }.
 * Returns { approved: true } | { approved: false } | { approved: false, error } (invalid content,
 * no prompt shown). Writing replaces any earlier approval of the same idea id.
 */
export async function approve(idea, resolvedFolder, options = {}) {
  const hash = approvalHash(idea, resolvedFolder)
  if (hash === null || typeof idea.id !== 'string' || idea.id === '') {
    return { approved: false, error: 'invalid_idea_content' }
  }
  const own = options.prompter === undefined
  const prompter = options.prompter ?? createPrompter({ input: options.input, output: options.output })
  try {
    const exclusions = Array.isArray(options.exclusions) ? options.exclusions : []
    prompter.write(`\nApprove idea ${idea.id} for automatic runs\n`)
    prompter.write('--- Text (exact) ---\n')
    prompter.write(`${idea.text}\n`)
    prompter.write('--- Context (exact) ---\n')
    prompter.write(`${idea.context ? idea.context : '(none)'}\n`)
    if (resolvedFolder === null) {
      prompter.write('--- Working folder ---\n')
      prompter.write(`${NO_FOLDER_NOTICE}\n`)
    } else {
      prompter.write('--- Resolved folder (a copy of it is made and sent to the provider) ---\n')
      prompter.write(`${resolvedFolder}\n`)
      prompter.write('--- Excluded from the copy ---\n')
      prompter.write(`${exclusions.length > 0 ? exclusions.join('\n') : '(none)'}\n`)
    }
    prompter.write('---\nAny edit of text, context or folder withdraws this approval.\n')
    const answer = await prompter.ask('Type "yes" to approve: ')
    if (answer.trim() !== 'yes') return { approved: false }
    let store
    try {
      store = readStore(options.baseDir)
    } catch {
      store = {} // a corrupt file authorises nothing, so replacing it loses nothing
    }
    store[idea.id] = { hash, approvedAt: options.now, preview: previewOf(idea.text) }
    writeStore(options.baseDir, store)
    return { approved: true }
  } finally {
    if (own) prompter.close()
  }
}

/** Removes the approval of an idea. Returns true when one existed. options: { baseDir }. */
export function revoke(ideaId, options = {}) {
  let store
  try {
    store = readStore(options.baseDir)
  } catch {
    return false
  }
  if (typeof ideaId !== 'string' || !Object.hasOwn(store, ideaId)) return false
  delete store[ideaId]
  writeStore(options.baseDir, store)
  return true
}

/** [{ ideaId, hash, approvedAt, preview }] from the local file (empty when missing or corrupt). */
export function listApprovals(options = {}) {
  let store
  try {
    store = readStore(options.baseDir)
  } catch {
    return []
  }
  return Object.keys(store).flatMap((ideaId) => {
    const hash = storedHash(store, ideaId)
    if (hash === null) return []
    const { approvedAt = null, preview = '' } = store[ideaId]
    return [{ ideaId, hash, approvedAt, preview }]
  })
}

/**
 * For the `approve` command: from items [{ idea, resolvedFolder }], those that requested approval
 * (`approvalRequested === true`, used for listing only) and are not validly approved right now.
 */
export function pendingApprovals(items, options = {}) {
  return items.filter(({ idea, resolvedFolder }) => idea?.approvalRequested === true && !isApproved(idea, resolvedFolder, options))
}

/**
 * Display-only map { ideaId: contentVersion } of locally valid approvals, for the lease record's
 * `approved` field. Never read back for authorisation.
 */
export function approvedVersions(items, options = {}) {
  const map = {}
  for (const { idea, resolvedFolder } of items) {
    if (isApproved(idea, resolvedFolder, options)) map[idea.id] = idea.contentVersion
  }
  return map
}
