// T072: edge cases of the spec for records, storage, the queue and the review helpers
// (very large output, corrupt storage, invalid shared records, removed services, approvals, shared mode off).
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS } from './constants.js'
import { editIdea, validateIdeaRecords } from './ideas.js'
import { FAILURE_REASONS, RUN_STATUS, capOutput, validateRunRecord } from './records.js'
import { applyResultDecision, describeRunFailure, reviewState } from './runs.js'
import { SURPLUS_STORAGE_KEYS, applySurplusRecords, emptySurplusState, loadSurplusState, saveSurplusState } from './storage.js'
import { addIdea, archiveIdea, decideRun, markLaunchedManually, updateIdea, updatePolicy } from './store.js'
import { evaluateSurplus } from './evaluation.js'
import { defaultPolicy } from './policy.js'
import { buildManualInstruction } from './instruction.js'
import { SERVICES } from '../data/services.js'

const CAP = 256 * 1024
const NOW = new Date('2026-11-03T10:00:00.000Z')
const bytes = (s) => Buffer.byteLength(s, 'utf8')

// --- very large output ------------------------------------------------------------------------------

test('capOutput cuts at 256 KB of UTF-8 bytes whatever the character width, never inside a character', () => {
  for (const [name, char] of [['1 byte', 'a'], ['2 bytes', 'é'], ['3 bytes', '€'], ['4 bytes', '😀']]) {
    const capped = capOutput(char.repeat(300000))
    assert.equal(capped.truncated, true, name)
    assert.ok(bytes(capped.text) <= CAP, `${name}: ${bytes(capped.text)} bytes`)
    assert.ok(bytes(capped.text) > CAP - 4, `${name}: keeps all but at most one character`)
    assert.ok(!capped.text.includes('�'), `${name}: no replacement character`)
    assert.equal(capped.text, char.repeat([...capped.text].length), `${name}: only whole characters`)
  }
})

test('capOutput cuts at every offset of a multi-byte boundary without invalid characters', () => {
  const filler = 'x'.repeat(CAP - 6)
  for (let pad = 0; pad < 8; pad += 1) {
    const text = `${filler}${'y'.repeat(pad)}😀€é😀😀`
    const capped = capOutput(text)
    assert.ok(bytes(capped.text) <= CAP)
    assert.ok(!capped.text.includes('�'), `pad ${pad}`)
    assert.equal(capped.truncated, bytes(text) > CAP)
  }
})

test('capOutput keeps exactly 256 KB and flags one byte more, and empty output is not truncated', () => {
  assert.deepEqual(capOutput('a'.repeat(CAP)), { text: 'a'.repeat(CAP), truncated: false })
  assert.equal(capOutput('a'.repeat(CAP + 1)).truncated, true)
  assert.deepEqual(capOutput(''), { text: '', truncated: false })
})

test('a capped output makes a valid run record, an uncapped one over 256 KB is refused', () => {
  const run = {
    id: 'r1', ideaId: 'i1', serviceId: 'claude',
    ideaSnapshot: { text: 't', context: '', workingFolder: null, resolvedFolder: null, contentVersion: 1 },
    mode: 'auto', cycleKey: 'claude:2026-11-05', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(),
    status: 'completed', failureReason: null, decisionInputs: {}, estimatedCostPct: 8, proposal: null, localRunDir: null,
  }
  const capped = capOutput('€'.repeat(200000))
  assert.equal(validateRunRecord({ ...run, output: capped.text, truncated: capped.truncated }).valid, true)
  assert.equal(validateRunRecord({ ...run, output: '€'.repeat(200000), truncated: true }).valid, false)
})

// --- corrupt storage --------------------------------------------------------------------------------

const memoryStorage = (initial = {}) => {
  const data = { ...initial }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, removeItem: (k) => { delete data[k] }, data }
}

test('every kind of corruption of every key loads as an empty or default state', () => {
  const corruptions = ['{not json', '[', 'null', '42', '"text"', 'true', '{"a":1}', '[1,null,"x",[],{}]', '\u0000\u0001']
  for (const raw of corruptions) {
    const storage = memoryStorage(Object.fromEntries(Object.values(SURPLUS_STORAGE_KEYS).map((key) => [key, raw])))
    const state = loadSurplusState(storage)
    assert.deepEqual(state.ideas, [], raw)
    assert.deepEqual(state.runs, [], raw)
    assert.deepEqual(state.cycles, [], raw)
    assert.deepEqual(state.policy, defaultPolicy(), raw)
    assert.equal(state.control, null, raw)
    assert.equal(state.lease, null, raw)
  }
})

test('a storage that throws on read or write never breaks load or save', () => {
  const throwing = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') }, removeItem() { throw new Error('x') } }
  assert.deepEqual(loadSurplusState(throwing).ideas, [])
  assert.equal(saveSurplusState(throwing, emptySurplusState()), false)
  assert.deepEqual(loadSurplusState(undefined).ideas, [])
})

test('a half-corrupt ideas list keeps the valid ideas and drops the rest', () => {
  const state = addIdea(emptySurplusState(), { text: 'good' }, { id: 'ok', now: NOW }).state
  const storage = memoryStorage({
    [SURPLUS_STORAGE_KEYS.ideas]: JSON.stringify([state.ideas[0], { id: 'bad', text: '' }, null, 'x', { ...state.ideas[0], id: 'bad2', size: 'huge' }]),
  })
  assert.deepEqual(loadSurplusState(storage).ideas.map((i) => i.id), ['ok'])
})

// --- invalid shared records never run ---------------------------------------------------------------

const shared = (logicalKey, payload, extra = {}) => ({ id: `rec-${logicalKey}`, record_type: 'routing_config', logical_key: logicalKey, version: 1, payload, ...extra })

test('invalid shared ideas are listed and never reach the queue the runner reads', () => {
  const good = addIdea(emptySurplusState(), { text: 'good' }, { id: 'ok', now: NOW }).idea
  const items = [
    shared('idea:ok', good),
    shared('idea:empty', { ...good, id: 'empty', text: '   ' }),
    shared('idea:size', { ...good, id: 'size', size: 'gigantic' }),
    shared('idea:status', { ...good, id: 'status', status: 'hacked' }),
    shared('idea:ctx', { ...good, id: 'ctx', context: 'x'.repeat(10001) }),
    shared('idea:mismatch', { ...good, id: 'someone-else' }),
    shared('idea:version', { ...good, id: 'version', contentVersion: 0 }),
    shared('idea:nopayload', null),
  ]
  const state = applySurplusRecords(emptySurplusState(), items)
  assert.deepEqual(state.ideas.map((i) => i.id), ['ok'])
  assert.equal(state.invalid.length, 7)
  // The payload-only check cannot see a key mismatch, every other defect is caught there too.
  const { ideas, invalid } = validateIdeaRecords(items.filter((i) => i.logical_key !== 'idea:mismatch').map((i) => i.payload))
  assert.equal(ideas.length, 1)
  assert.equal(invalid.length, 6)
})

// --- approvals invalidated by edits (the runner compares a hash; the app must bump contentVersion) ---

test('each of text, context and working folder bumps contentVersion and says the approval is withdrawn', () => {
  let state = addIdea(emptySurplusState(), { text: 'a', context: 'c', workingFolder: 'proj' }, { id: 'i1', now: NOW }).state
  for (const changes of [{ text: 'b' }, { context: 'd' }, { workingFolder: 'other' }, { workingFolder: null }]) {
    const before = state.ideas[0]
    const result = updateIdea(state, 'i1', changes, NOW)
    assert.equal(result.ok, true)
    assert.equal(result.approvalWithdrawn, true, JSON.stringify(changes))
    assert.equal(result.idea.contentVersion, before.contentVersion + 1)
    state = result.state
  }
})

test('priority, size, order and the approval request keep the approval; same-value edits are not edits', () => {
  const state = addIdea(emptySurplusState(), { text: 'a', workingFolder: 'proj' }, { id: 'i1', now: NOW }).state
  const result = updateIdea(state, 'i1', { priority: 'high', size: 'small', order: 9, approvalRequested: true }, NOW)
  assert.equal(result.approvalWithdrawn, false)
  assert.equal(result.idea.contentVersion, 1)
  assert.equal(editIdea(state.ideas[0], { text: 'a', workingFolder: 'proj' }, NOW).approvalWithdrawn, false)
})

test('a client cannot change contentVersion, status or serviceId through an edit', () => {
  const idea = addIdea(emptySurplusState(), { text: 'a' }, { id: 'i1', now: NOW }).idea
  const edited = editIdea(idea, { contentVersion: 99, status: STATUS.RUNNING, serviceId: 'claude', text: 'b' }, NOW).idea
  assert.equal(edited.contentVersion, 2)
  assert.equal(edited.status, STATUS.WAITING)
  assert.equal(edited.serviceId, null)
})

// --- shared mode off: the queue, the policy and the evaluation work without any network -------------

test('the queue, the policy and the evaluation work with no shared state at all', () => {
  let state = emptySurplusState()
  state = addIdea(state, { text: 'draft the release notes', size: 'small' }, { id: 'i1', now: NOW }).state
  state = updateIdea(state, 'i1', { priority: 'high' }, NOW).state
  const policy = updatePolicy(state, (p) => ({ ...p, services: { ...p.services, claude: { ...p.services.claude, surplusEnabled: true } } }))
  assert.equal(policy.ok, true)
  const evaluation = evaluateSurplus({
    now: NOW, state: {}, services: SERVICES, policy: policy.state.policy, ideas: policy.state.ideas, runs: [], folderChecks: null, mode: 'preview',
  })
  assert.equal(evaluation.selected, null)
  assert.ok(evaluation.reason.length > 0)
  assert.equal(evaluation.services.find((s) => s.serviceId === 'claude').rules.find((r) => r.id === 'R1').pass, true)
})

test('automatic runs cannot be enabled in a policy without declared protected hours and acknowledged disclosures', () => {
  const state = emptySurplusState()
  const enable = (extra) => updatePolicy(state, (p) => ({ ...p, ...extra, services: { ...p.services, claude: { ...p.services.claude, autoRunEnabled: true, ...extra.claude } } }))
  assert.equal(enable({ claude: { disclosuresAckAt: NOW.toISOString() } }).ok, false, 'no protected hours')
  assert.equal(enable({ protectedHours: [{ days: [0], start: '23:00', end: '06:00' }] }).ok, false, 'no acknowledgement')
})

// --- removed or renamed service ---------------------------------------------------------------------

test('launching an idea manually on a service that is not supported anymore is refused, not thrown', () => {
  const state = addIdea(emptySurplusState(), { text: 'a' }, { id: 'i1', now: NOW }).state
  for (const serviceId of ['copilot', 'removed', '', null, undefined]) {
    const result = markLaunchedManually(state, 'i1', serviceId, NOW)
    assert.equal(result.ok, false, String(serviceId))
    assert.equal(result.error.code, 'transition_invalid')
  }
})

test('a manual instruction for a service that is gone throws a TypeError that the notice catches', () => {
  assert.throws(() => buildManualInstruction({ text: 'a' }, undefined), TypeError)
  assert.throws(() => buildManualInstruction({ text: 'a' }, { name: 'Gone', surplus: null }), TypeError)
})

test('review helpers cope with a run whose idea was deleted and a failure code that no longer exists', () => {
  const run = {
    id: 'r1', ideaId: 'gone', serviceId: 'claude', status: RUN_STATUS.FAILED,
    failureReason: { code: 'some_future_code', message: '' },
  }
  assert.deepEqual(reviewState(run, undefined).actions, [])
  assert.deepEqual(reviewState(run, null).actions, [])
  const failure = describeRunFailure(run)
  assert.equal(failure.code, 'some_future_code')
  assert.ok(failure.message.length > 0)
  assert.equal(applyResultDecision(undefined, 'discarded', NOW).error.code, 'idea_required')
  assert.equal(decideRun(emptySurplusState(), 'gone', 'discarded', NOW).error.code, 'idea_not_found')
  assert.equal(archiveIdea(emptySurplusState(), 'gone', NOW).ok, false)
  assert.ok(Object.values(FAILURE_REASONS).length > 0)
})
