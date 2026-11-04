import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  APPROVALS_FILE,
  canonicalJson,
  approvalHash,
  isApproved,
  approve,
  revoke,
  listApprovals,
  pendingApprovals,
  approvedVersions,
  createPrompter,
} from './approvals.js'

// macOS os.tmpdir() lives under /var, which the folder rules refuse: use a gitignored dir in the repo.
const TMP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp')
const FOLDER = '/Users/test/projects/demo'
const NOW = '2026-11-03T10:00:00.000Z'
const EXCLUSIONS = ['.env*', '*.pem', 'node_modules']

function makeIdea(overrides = {}) {
  return {
    id: 'idea-1',
    text: 'Refactor the parser',
    context: 'Keep the public API',
    workingFolder: 'demo',
    approvalRequested: true,
    contentVersion: 1,
    ...overrides,
  }
}

function io(lines) {
  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk) => { printed += chunk.toString() })
  for (const line of lines) input.write(`${line}\n`)
  input.end()
  return { input, output, printed: () => printed }
}

describe('approvals', () => {
  let baseDir

  beforeEach(() => {
    fs.mkdirSync(TMP_ROOT, { recursive: true })
    baseDir = fs.mkdtempSync(path.join(TMP_ROOT, 'approvals-'))
  })

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  const grant = async (idea = makeIdea(), folder = FOLDER) =>
    approve(idea, folder, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io(['yes']) })

  describe('hash', () => {
    test('canonicalJson sorts keys recursively and is independent of insertion order', () => {
      assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }), '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}')
      assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
    })

    test('the hash is SHA-256 of the canonical JSON of {text, context, resolvedFolder}', () => {
      const expected = createHash('sha256')
        .update('{"context":"Keep the public API","resolvedFolder":"/Users/test/projects/demo","text":"Refactor the parser"}', 'utf8')
        .digest('hex')
      assert.equal(approvalHash(makeIdea(), FOLDER), expected)
    })

    test('a missing context hashes like an empty one; other idea fields do not matter', () => {
      const base = approvalHash(makeIdea({ context: '' }), FOLDER)
      assert.equal(approvalHash(makeIdea({ context: undefined }), FOLDER), base)
      assert.equal(approvalHash(makeIdea({ context: '', priority: 'high', contentVersion: 9, id: 'other' }), FOLDER), base)
    })

    test('editing text, context or resolved folder changes the hash', () => {
      const base = approvalHash(makeIdea(), FOLDER)
      assert.notEqual(approvalHash(makeIdea({ text: 'Refactor the parser!' }), FOLDER), base)
      assert.notEqual(approvalHash(makeIdea({ context: 'Keep the public API.' }), FOLDER), base)
      assert.notEqual(approvalHash(makeIdea(), `${FOLDER}2`), base)
    })

    test('fields cannot be shifted from one to another to forge the same hash', () => {
      assert.notEqual(
        approvalHash(makeIdea({ text: 'ab', context: 'c' }), FOLDER),
        approvalHash(makeIdea({ text: 'a', context: 'bc' }), FOLDER),
      )
    })

    test('invalid input has no hash', () => {
      assert.equal(approvalHash(makeIdea({ text: undefined }), FOLDER), null)
      assert.equal(approvalHash(makeIdea(), ''), null)
      assert.equal(approvalHash(makeIdea(), undefined), null)
      assert.equal(approvalHash(null, FOLDER), null)
    })
  })

  describe('isApproved', () => {
    test('is false without a local approvals file', () => {
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
    })

    test('is true for exactly the approved content', async () => {
      assert.deepEqual(await grant(), { approved: true })
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), true)
    })

    test('editing text, context or folder invalidates the approval', async () => {
      await grant()
      assert.equal(isApproved(makeIdea({ text: 'Refactor the lexer' }), FOLDER, { baseDir }), false)
      assert.equal(isApproved(makeIdea({ context: 'Break the API' }), FOLDER, { baseDir }), false)
      assert.equal(isApproved(makeIdea(), '/Users/test/projects/other', { baseDir }), false)
    })

    test('re-approving the edited content makes it valid again and the old content invalid', async () => {
      await grant()
      const edited = makeIdea({ text: 'Refactor the lexer' })
      await grant(edited)
      assert.equal(isApproved(edited, FOLDER, { baseDir }), true)
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
    })

    test('is bound to the idea id', async () => {
      await grant()
      assert.equal(isApproved(makeIdea({ id: 'idea-2' }), FOLDER, { baseDir }), false)
    })

    test('an approvalRequested flag from the shared store never authorises (FR-013)', () => {
      assert.equal(isApproved(makeIdea({ approvalRequested: true }), FOLDER, { baseDir }), false)
    })

    test('a lease approved map or an approved flag on the idea never authorises (FR-013)', () => {
      const forged = makeIdea({ approved: true, approvedHash: approvalHash(makeIdea(), FOLDER), lease: { approved: { 'idea-1': 1 } } })
      assert.equal(isApproved(forged, FOLDER, { baseDir }), false)
      // extra arguments or options carrying a lease are ignored
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir, lease: { approved: { 'idea-1': 1 } }, approved: { 'idea-1': 1 } }), false)
    })

    test('a hash planted in the idea does not help, only the local file counts', async () => {
      await grant(makeIdea({ id: 'idea-9' }))
      const planted = makeIdea({ id: 'idea-1', hash: approvalHash(makeIdea({ id: 'idea-9' }), FOLDER) })
      assert.equal(isApproved(planted, FOLDER, { baseDir }), false)
    })

    test('fails closed on a corrupt approvals file or a malformed entry', () => {
      const file = path.join(baseDir, APPROVALS_FILE)
      fs.writeFileSync(file, '{not json', { mode: 0o600 })
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
      fs.writeFileSync(file, JSON.stringify({ 'idea-1': { hash: 42 } }), { mode: 0o600 })
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
      fs.writeFileSync(file, JSON.stringify([]), { mode: 0o600 })
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
    })

    test('inherited property names are not treated as idea ids', () => {
      assert.equal(isApproved(makeIdea({ id: '__proto__' }), FOLDER, { baseDir }), false)
      assert.equal(isApproved(makeIdea({ id: 'constructor' }), FOLDER, { baseDir }), false)
    })
  })

  describe('approvals file', () => {
    test('is created with mode 0600 inside a 0700 directory', async () => {
      const nested = path.join(baseDir, 'nested', '.kairos-runner')
      await approve(makeIdea(), FOLDER, { baseDir: nested, now: NOW, exclusions: EXCLUSIONS, ...io(['yes']) })
      assert.equal(fs.statSync(nested).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(nested, APPROVALS_FILE)).mode & 0o777, 0o600)
    })

    test('stays 0600 after a rewrite (revoke)', async () => {
      await grant()
      revoke('idea-1', { baseDir })
      assert.equal(fs.statSync(path.join(baseDir, APPROVALS_FILE)).mode & 0o777, 0o600)
    })

    test('stores hash, approvedAt and a preview keyed by idea id', async () => {
      await grant()
      const stored = JSON.parse(fs.readFileSync(path.join(baseDir, APPROVALS_FILE), 'utf8'))
      assert.deepEqual(Object.keys(stored), ['idea-1'])
      assert.equal(stored['idea-1'].hash, approvalHash(makeIdea(), FOLDER))
      assert.equal(stored['idea-1'].approvedAt, NOW)
      assert.equal(typeof stored['idea-1'].preview, 'string')
      assert.ok(stored['idea-1'].preview.includes('Refactor the parser'))
    })

    test('leaves no temporary file behind', async () => {
      await grant()
      assert.deepEqual(fs.readdirSync(baseDir), [APPROVALS_FILE])
    })
  })

  describe('approve prompt', () => {
    test('prints exact text, context, resolved folder and exclusions before asking for yes', async () => {
      const streams = io(['yes'])
      const idea = makeIdea({ text: 'Line one\nLine  two with  spaces', context: 'Some context' })
      await approve(idea, FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...streams })
      const out = streams.printed()
      assert.ok(out.includes('Line one\nLine  two with  spaces'))
      assert.ok(out.includes('Some context'))
      assert.ok(out.includes(FOLDER))
      for (const pattern of EXCLUSIONS) assert.ok(out.includes(pattern), `missing exclusion ${pattern}`)
      assert.ok(out.indexOf('yes') > out.indexOf(FOLDER), 'the question comes after the details')
      assert.ok(out.lastIndexOf('yes') > out.indexOf(EXCLUSIONS[0]))
    })

    test('anything other than the exact word yes does not approve', async () => {
      for (const answer of ['y', 'Yes', 'YES', 'no', '', 'yes please', 'oui']) {
        const result = await approve(makeIdea(), FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io([answer]) })
        assert.deepEqual(result, { approved: false }, `answer ${JSON.stringify(answer)}`)
        assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
      }
      assert.equal(fs.existsSync(path.join(baseDir, APPROVALS_FILE)), false)
    })

    test('surrounding whitespace around yes is tolerated', async () => {
      const result = await approve(makeIdea(), FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io(['  yes  ']) })
      assert.deepEqual(result, { approved: true })
    })

    test('a closed input stream without an answer does not approve', async () => {
      const result = await approve(makeIdea(), FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io([]) })
      assert.deepEqual(result, { approved: false })
    })

    test('a refused approval keeps an earlier approval of other content untouched', async () => {
      await grant()
      const edited = makeIdea({ text: 'Different' })
      const result = await approve(edited, FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io(['no']) })
      assert.equal(result.approved, false)
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), true)
    })

    test('invalid content is refused without prompting', async () => {
      const streams = io(['yes'])
      const result = await approve(makeIdea({ text: '' }), FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...streams })
      assert.equal(result.approved, false)
      assert.equal(typeof result.error, 'string')
      const noFolder = await approve(makeIdea(), '', { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io(['yes']) })
      assert.equal(noFolder.approved, false)
    })

    test('one prompter can serve several approvals in a row', async () => {
      const streams = io(['yes', 'no', 'yes'])
      const prompter = createPrompter(streams)
      const ideas = [makeIdea({ id: 'a' }), makeIdea({ id: 'b' }), makeIdea({ id: 'c' })]
      const results = []
      for (const idea of ideas) results.push((await approve(idea, FOLDER, { baseDir, now: NOW, exclusions: EXCLUSIONS, prompter })).approved)
      prompter.close()
      assert.deepEqual(results, [true, false, true])
      assert.deepEqual(listApprovals({ baseDir }).map((entry) => entry.ideaId).sort(), ['a', 'c'])
    })
  })

  describe('no working folder (FR-017)', () => {
    const noFolder = (overrides = {}) => makeIdea({ workingFolder: null, ...overrides })

    test('the hash is SHA-256 of the canonical JSON of {text, context, resolvedFolder: null}', () => {
      const expected = createHash('sha256')
        .update('{"context":"Keep the public API","resolvedFolder":null,"text":"Refactor the parser"}', 'utf8')
        .digest('hex')
      assert.equal(approvalHash(noFolder(), null), expected)
    })

    test('only an explicit null means no folder: empty string and undefined stay invalid', () => {
      assert.equal(approvalHash(noFolder(), ''), null)
      assert.equal(approvalHash(noFolder(), undefined), null)
      assert.notEqual(approvalHash(noFolder(), null), approvalHash(noFolder(), FOLDER))
    })

    test('editing text or context invalidates the approval; other fields do not', async () => {
      await grant(noFolder(), null)
      assert.equal(isApproved(noFolder(), null, { baseDir }), true)
      assert.equal(isApproved(noFolder({ priority: 'high', contentVersion: 7 }), null, { baseDir }), true)
      assert.equal(isApproved(noFolder({ text: 'Refactor the lexer' }), null, { baseDir }), false)
      assert.equal(isApproved(noFolder({ context: 'Break the API' }), null, { baseDir }), false)
    })

    test('an idea that gains a folder later must be approved again, and the reverse too', async () => {
      await grant(noFolder(), null)
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
      await grant(makeIdea(), FOLDER)
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), true)
      assert.equal(isApproved(noFolder(), null, { baseDir }), false, 'the same id now holds the folder approval')
    })

    test('the prompt says there is no working folder instead of printing one, and still requires yes', async () => {
      const streams = io(['yes'])
      const result = await approve(noFolder({ text: 'Draft the plan' }), null, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...streams })
      assert.deepEqual(result, { approved: true })
      const out = streams.printed()
      assert.ok(out.includes('Draft the plan'))
      assert.ok(out.includes('Keep the public API'))
      assert.ok(out.includes('No working folder: this idea runs in an empty scratch directory with no project files'))
      assert.ok(!out.includes('Resolved folder'))
      assert.ok(!out.includes('null'))
      assert.ok(out.lastIndexOf('yes') > out.indexOf('No working folder'), 'the question comes after the details')
      assert.equal(isApproved(noFolder({ text: 'Draft the plan' }), null, { baseDir }), true)
    })

    test('anything other than yes approves nothing', async () => {
      const result = await approve(noFolder(), null, { baseDir, now: NOW, exclusions: EXCLUSIONS, ...io(['no']) })
      assert.deepEqual(result, { approved: false })
      assert.equal(isApproved(noFolder(), null, { baseDir }), false)
    })

    test('pendingApprovals and approvedVersions work with a null folder', async () => {
      await grant(noFolder({ id: 'a', contentVersion: 2 }), null)
      const items = [
        { idea: noFolder({ id: 'a', contentVersion: 2 }), resolvedFolder: null },
        { idea: noFolder({ id: 'b' }), resolvedFolder: null },
      ]
      assert.deepEqual(pendingApprovals(items, { baseDir }).map((item) => item.idea.id), ['b'])
      assert.deepEqual(approvedVersions(items, { baseDir }), { a: 2 })
    })
  })

  describe('revoke and list', () => {
    test('revoke removes an approval and reports whether one existed', async () => {
      await grant()
      assert.equal(revoke('idea-1', { baseDir }), true)
      assert.equal(isApproved(makeIdea(), FOLDER, { baseDir }), false)
      assert.equal(revoke('idea-1', { baseDir }), false)
      assert.equal(revoke('never-approved', { baseDir }), false)
    })

    test('revoke does not touch other approvals', async () => {
      await grant(makeIdea({ id: 'a' }))
      await grant(makeIdea({ id: 'b' }))
      revoke('a', { baseDir })
      assert.equal(isApproved(makeIdea({ id: 'b' }), FOLDER, { baseDir }), true)
    })

    test('listApprovals returns id, hash, approvedAt and preview', async () => {
      assert.deepEqual(listApprovals({ baseDir }), [])
      await grant()
      const [entry] = listApprovals({ baseDir })
      assert.equal(entry.ideaId, 'idea-1')
      assert.equal(entry.hash, approvalHash(makeIdea(), FOLDER))
      assert.equal(entry.approvedAt, NOW)
      assert.ok(entry.preview.includes('Refactor'))
    })
  })

  describe('pending and display helpers', () => {
    test('pendingApprovals lists requested, not yet validly approved ideas', async () => {
      await grant(makeIdea({ id: 'done' }))
      const items = [
        { idea: makeIdea({ id: 'done' }), resolvedFolder: FOLDER },
        { idea: makeIdea({ id: 'todo' }), resolvedFolder: FOLDER },
        { idea: makeIdea({ id: 'edited', text: 'x' }), resolvedFolder: FOLDER },
        { idea: makeIdea({ id: 'not-requested', approvalRequested: false }), resolvedFolder: FOLDER },
      ]
      await grant(makeIdea({ id: 'edited', text: 'old' }))
      const pending = pendingApprovals(items, { baseDir }).map((item) => item.idea.id)
      assert.deepEqual(pending, ['todo', 'edited'])
    })

    test('approvedVersions builds the display-only map from locally valid approvals', async () => {
      await grant(makeIdea({ id: 'a', contentVersion: 3 }))
      const items = [
        { idea: makeIdea({ id: 'a', contentVersion: 3 }), resolvedFolder: FOLDER },
        { idea: makeIdea({ id: 'b', contentVersion: 1 }), resolvedFolder: FOLDER },
      ]
      assert.deepEqual(approvedVersions(items, { baseDir }), { a: 3 })
    })
  })
})
