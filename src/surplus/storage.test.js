import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS } from './constants.js'
import { createIdea, editIdea, transitionIdea } from './ideas.js'
import { defaultPolicy } from './policy.js'
import {
  SURPLUS_STORAGE_KEYS,
  applySurplusRecords,
  emptySurplusState,
  loadCycles,
  loadIdeas,
  loadPolicy,
  loadRuns,
  loadSurplusState,
  mergeIdea,
  mergeIdeaAfterConflict,
  saveCycles,
  saveIdeas,
  savePolicy,
  saveRuns,
  saveSurplusState,
} from './storage.js'
import { defaultProviderSurplus } from './policy.js'

const PA = 'p_claudeaaaaaa'

const T0 = new Date('2026-11-03T10:00:00.000Z')
const T1 = new Date('2026-11-03T11:00:00.000Z')
const T2 = new Date('2026-11-03T12:00:00.000Z')

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

function makeIdea(overrides = {}, now = T0) {
  const result = createIdea({ id: 'i1', text: 'Refactor parser', now, ...overrides })
  assert.equal(result.ok, true)
  return result.idea
}

function runRecord(overrides = {}) {
  return {
    id: 'r1',
    ideaId: 'i1',
    serviceId: 'claude',
    ideaSnapshot: { text: 't', context: '', workingFolder: null, resolvedFolder: null, contentVersion: 1 },
    mode: 'auto',
    cycleKey: 'claude:2026-11-10',
    startedAt: '2026-11-03T10:00:00.000Z',
    endedAt: null,
    status: 'running',
    failureReason: null,
    decisionInputs: {},
    estimatedCostPct: 8,
    output: '',
    truncated: false,
    proposal: null,
    localRunDir: null,
    ...overrides,
  }
}

function cycleRecord(overrides = {}) {
  return { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 40, readAt: '2026-11-03T10:00:00.000Z', ...overrides }
}

let versionCounter = 0
function item(logicalKey, payload, extra = {}) {
  versionCounter += 1
  return {
    id: `rec-${versionCounter}`,
    workspace_id: 'ws',
    record_type: 'routing_config',
    logical_key: logicalKey,
    payload,
    version: 1,
    updated_at: '2026-11-03T10:00:00.000Z',
    deleted_at: null,
    ...extra,
  }
}

// --- keys, load, save ---------------------------------------------------------------------

test('storage keys live under kairos:surplus:*', () => {
  for (const key of Object.values(SURPLUS_STORAGE_KEYS)) assert.match(key, /^kairos:surplus:/)
  assert.equal(SURPLUS_STORAGE_KEYS.ideas, 'kairos:surplus:ideas')
  assert.equal(SURPLUS_STORAGE_KEYS.policy, 'kairos:surplus:policy')
  assert.equal(SURPLUS_STORAGE_KEYS.runs, 'kairos:surplus:runs')
  assert.equal(SURPLUS_STORAGE_KEYS.cycles, 'kairos:surplus:cycles')
})

test('ideas, policy, runs and cycles round-trip through an injected storage', () => {
  const storage = memoryStorage()
  const ideas = [makeIdea(), makeIdea({ id: 'i2', text: 'Other' })]
  const policy = defaultPolicy()
  policy.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const runs = [runRecord()]
  const cycles = [cycleRecord()]

  assert.equal(saveIdeas(storage, ideas), true)
  assert.equal(savePolicy(storage, policy), true)
  assert.equal(saveRuns(storage, runs), true)
  assert.equal(saveCycles(storage, cycles), true)

  assert.ok(storage.data.has('kairos:surplus:ideas'))
  assert.deepEqual(loadIdeas(storage), ideas)
  assert.deepEqual(loadPolicy(storage), policy)
  assert.deepEqual(loadRuns(storage), runs)
  assert.deepEqual(loadCycles(storage), cycles)
})

test('nothing stored loads as empty ideas, runs, cycles and the default policy', () => {
  const storage = memoryStorage()
  assert.deepEqual(loadIdeas(storage), [])
  assert.deepEqual(loadRuns(storage), [])
  assert.deepEqual(loadCycles(storage), [])
  assert.deepEqual(loadPolicy(storage), defaultPolicy())
  assert.deepEqual(loadSurplusState(storage), emptySurplusState())
})

test('corrupt JSON loads as empty', () => {
  const storage = memoryStorage({
    'kairos:surplus:ideas': '{not json',
    'kairos:surplus:policy': '<<<',
    'kairos:surplus:runs': 'nope',
    'kairos:surplus:cycles': '[[',
    'kairos:surplus:control': '}',
    'kairos:surplus:lease': '}',
  })
  assert.deepEqual(loadIdeas(storage), [])
  assert.deepEqual(loadPolicy(storage), defaultPolicy())
  assert.deepEqual(loadRuns(storage), [])
  assert.deepEqual(loadCycles(storage), [])
  assert.deepEqual(loadSurplusState(storage), emptySurplusState())
})

test('wrong JSON shapes load as empty and invalid entries are dropped', () => {
  const good = makeIdea()
  const storage = memoryStorage({
    'kairos:surplus:ideas': JSON.stringify([good, { id: 'bad', text: '' }, 42, null]),
    'kairos:surplus:runs': JSON.stringify({ not: 'an array' }),
    'kairos:surplus:cycles': JSON.stringify([cycleRecord(), { serviceId: 'claude' }]),
    'kairos:surplus:policy': JSON.stringify({ schemaVersion: 99 }),
  })
  assert.deepEqual(loadIdeas(storage), [good])
  assert.deepEqual(loadRuns(storage), [])
  assert.deepEqual(loadCycles(storage), [cycleRecord()])
  assert.deepEqual(loadPolicy(storage), defaultPolicy())
})

test('a throwing or missing storage never throws', () => {
  const broken = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('quota')
    },
  }
  assert.deepEqual(loadIdeas(broken), [])
  assert.deepEqual(loadIdeas(null), [])
  assert.equal(saveIdeas(broken, [makeIdea()]), false)
  assert.equal(saveIdeas(undefined, [makeIdea()]), false)
})

test('saveSurplusState and loadSurplusState round-trip the whole state without the transient index', () => {
  const storage = memoryStorage()
  const state = {
    ...emptySurplusState(),
    ideas: [makeIdea()],
    runs: [runRecord()],
    cycles: [cycleRecord()],
    control: { autoRunEnabled: false, updatedAt: '2026-11-03T10:00:00.000Z' },
    recordIndex: { 'idea:i1': { id: 'x', version: 3 } },
    invalid: [{ logicalKey: 'idea:zz' }],
  }
  saveSurplusState(storage, state)
  const loaded = loadSurplusState(storage)
  assert.deepEqual(loaded.ideas, state.ideas)
  assert.deepEqual(loaded.runs, state.runs)
  assert.deepEqual(loaded.cycles, state.cycles)
  assert.deepEqual(loaded.control, state.control)
  assert.deepEqual(loaded.recordIndex, {})
  assert.deepEqual(loaded.invalid, [])
})

// --- applySurplusRecords ------------------------------------------------------------------

test('applySurplusRecords ignores quota_state and snapshot records', () => {
  const base = emptySurplusState()
  const out = applySurplusRecords(base, [
    item('idea:i1', makeIdea(), { record_type: 'quota_state' }),
    item('weekly-history:2026-W44', { weekKey: '2026-W44' }, { record_type: 'snapshot' }),
    item('claude:weekly', { value: 5 }, { record_type: 'quota_state' }),
  ])
  assert.deepEqual(out.ideas, [])
  assert.deepEqual(out.recordIndex, {})
  assert.deepEqual(out.invalid, [])
})

test('applySurplusRecords ignores routing_config keys outside the known namespaces', () => {
  const out = applySurplusRecords(emptySurplusState(), [
    item('something-else', { a: 1 }),
    item('idea:', makeIdea()),
    item('cycle:gemini:2026-11-10', cycleRecord({ serviceId: 'gemini' })),
    item('cycle:claude:bad-date', cycleRecord()),
    item('weekly-history:2026-W44', {}),
    item(undefined, {}),
  ])
  assert.deepEqual(out.ideas, [])
  assert.deepEqual(out.cycles, [])
  assert.deepEqual(out.recordIndex, {})
  assert.deepEqual(out.invalid, [])
})

test('applySurplusRecords applies every known namespace and indexes the shared records', () => {
  const idea = makeIdea()
  const policy = defaultPolicy()
  policy.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const control = { autoRunEnabled: true, updatedAt: '2026-11-03T10:00:00.000Z' }
  const lease = {
    designatedDeviceId: 'd1',
    designatedDeviceName: 'Mac',
    designatedAt: '2026-11-03T10:00:00.000Z',
    deviceId: 'd1',
    deviceName: 'Mac',
    startedAt: '2026-11-03T10:00:00.000Z',
    heartbeatAt: '2026-11-03T10:01:00.000Z',
    leaseSeconds: 180,
    approved: { i1: 1 },
  }
  const items = [
    item('idea:i1', idea),
    item('surplus-policy', policy),
    item('surplus-control', control),
    item('runner-lease', lease),
    item('run:r1', runRecord()),
    item('cycle:claude:2026-11-10', cycleRecord()),
  ]
  const out = applySurplusRecords(emptySurplusState(), items)
  assert.deepEqual(out.ideas, [idea])
  assert.deepEqual(out.policy, policy)
  assert.deepEqual(out.control, control)
  assert.deepEqual(out.lease, lease)
  assert.deepEqual(out.runs, [runRecord()])
  assert.deepEqual(out.cycles, [cycleRecord()])
  assert.deepEqual(Object.keys(out.recordIndex).sort(), items.map((i) => i.logical_key).sort())
  assert.equal(out.recordIndex['idea:i1'].id, items[0].id)
  assert.deepEqual(out.invalid, [])
})

test('applySurplusRecords does not mutate its base', () => {
  const base = { ...emptySurplusState(), ideas: [makeIdea()] }
  const snapshot = JSON.parse(JSON.stringify(base))
  applySurplusRecords(base, [item('idea:i2', makeIdea({ id: 'i2' })), item('idea:i1', makeIdea({ text: 'Changed' }, T1))])
  assert.deepEqual(JSON.parse(JSON.stringify(base)), snapshot)
})

test('invalid records are listed and never applied', () => {
  const out = applySurplusRecords(emptySurplusState(), [
    item('idea:bad', { id: 'bad', text: '', priority: 'urgent' }, { id: 'rec-bad', version: 4 }),
    item('idea:i9', makeIdea({ id: 'other' })), // payload id does not match the key
    item('surplus-policy', { schemaVersion: 1 }),
    item('surplus-control', { autoRunEnabled: 'yes' }),
    item('run:r1', runRecord({ status: 'weird' })),
    item('cycle:claude:2026-11-10', cycleRecord({ lastWeeklyRemainingPct: 400 })),
    item('cycle:claude:2026-11-17', cycleRecord()), // payload resetDate does not match the key
    item('runner-lease', { nope: true }),
  ])
  assert.deepEqual(out.ideas, [])
  assert.deepEqual(out.runs, [])
  assert.deepEqual(out.cycles, [])
  assert.equal(out.control, null)
  assert.equal(out.lease, null)
  assert.deepEqual(out.policy, defaultPolicy())
  assert.deepEqual(out.recordIndex, {})
  assert.equal(out.invalid.length, 8)
  const bad = out.invalid.find((e) => e.logicalKey === 'idea:bad')
  assert.equal(bad.kind, 'idea')
  assert.equal(bad.recordId, 'rec-bad')
  assert.equal(bad.version, 4)
  assert.ok(bad.errors.length > 0)
})

test('an invalid update does not clobber the previously applied valid record', () => {
  const idea = makeIdea()
  const first = applySurplusRecords(emptySurplusState(), [item('idea:i1', idea)])
  const second = applySurplusRecords(first, [item('idea:i1', { ...idea, priority: 'urgent' }, { version: 2 })])
  assert.deepEqual(second.ideas, [idea])
  assert.equal(second.invalid.length, 1)
})

test('invalid entries are replaced, not accumulated, across calls for the same key', () => {
  const bad = item('idea:bad', { id: 'bad' })
  const once = applySurplusRecords(emptySurplusState(), [bad])
  const twice = applySurplusRecords(once, [bad])
  assert.equal(twice.invalid.length, 1)
  const fixed = applySurplusRecords(twice, [item('idea:bad', makeIdea({ id: 'bad' }), { version: 2 })])
  assert.equal(fixed.invalid.length, 0)
  assert.equal(fixed.ideas.length, 1)
})

test('a shared idea unknown locally is adopted', () => {
  const idea = makeIdea({ id: 'i7' })
  const out = applySurplusRecords(emptySurplusState(), [item('idea:i7', idea)])
  assert.deepEqual(out.ideas, [idea])
})

test('a stale shared idea does not overwrite a newer local edit', () => {
  const shared = makeIdea({ text: 'Original' }, T0)
  const edited = editIdea(shared, { text: 'Edited locally', priority: 'high' }, T2)
  assert.equal(edited.ok, true)
  const base = { ...emptySurplusState(), ideas: [edited.idea] }
  const out = applySurplusRecords(base, [item('idea:i1', shared)])
  assert.equal(out.ideas[0].text, 'Edited locally')
  assert.equal(out.ideas[0].priority, 'high')
  assert.equal(out.ideas[0].contentVersion, 2)
  assert.equal(out.ideas[0].updatedAt, T2.toISOString())
})

test('a newer shared idea replaces older local user fields', () => {
  const local = makeIdea({ text: 'Original' }, T0)
  const remote = editIdea(local, { text: 'Edited elsewhere', size: 'large' }, T2).idea
  const out = applySurplusRecords({ ...emptySurplusState(), ideas: [local] }, [item('idea:i1', remote)])
  assert.deepEqual(out.ideas, [remote])
})

test('runner-owned fields come from the shared idea when it is newer, user fields from the newer edit', () => {
  const local = makeIdea({}, T0)
  const claimed = transitionIdea(local, STATUS.RUNNING, { now: T2, serviceId: 'claude', lastRunId: 'r1' })
  const out = applySurplusRecords({ ...emptySurplusState(), ideas: [local] }, [item('idea:i1', claimed)])
  assert.equal(out.ideas[0].status, STATUS.RUNNING)
  assert.equal(out.ideas[0].serviceId, 'claude')
  assert.equal(out.ideas[0].lastRunId, 'r1')
})

test('mergeIdea keeps a newer local edit but still takes a runner claim from a stale-looking shared idea', () => {
  const base = makeIdea({}, T0)
  const claimed = transitionIdea(base, STATUS.RUNNING, { now: T1, serviceId: 'claude', lastRunId: 'r1' })
  const localEdit = editIdea(base, { priority: 'high' }, T2).idea // local newer, still 'waiting'
  const merged = mergeIdea(localEdit, claimed)
  assert.equal(merged.priority, 'high')
  assert.equal(merged.status, STATUS.RUNNING)
  assert.equal(merged.serviceId, 'claude')
  assert.equal(merged.lastRunId, 'r1')
  assert.equal(merged.updatedAt, T2.toISOString())
})

test('mergeIdea keeps local runner-owned fields when local is newer and not a waiting-to-running race', () => {
  const base = makeIdea({}, T0)
  const failed = transitionIdea(transitionIdea(base, STATUS.RUNNING, { now: T0, serviceId: 'claude', lastRunId: 'r1' }), STATUS.FAILED, { now: T1 })
  const requeued = transitionIdea(failed, STATUS.WAITING, { now: T2 })
  const merged = mergeIdea(requeued, failed)
  assert.equal(merged.status, STATUS.WAITING)
  assert.equal(merged.serviceId, null)
})

test('mergeIdea is a no-op for identical ideas and does not mutate its inputs', () => {
  const a = Object.freeze(makeIdea())
  const b = Object.freeze({ ...a })
  assert.deepEqual(mergeIdea(a, b), a)
})

test('mergeIdeaAfterConflict keeps local user fields and server runner fields', () => {
  const base = makeIdea({}, T0)
  const server = transitionIdea(base, STATUS.RUNNING, { now: T1, serviceId: 'chatgpt', lastRunId: 'r9' })
  const local = editIdea(base, { priority: 'low', size: 'small' }, T2).idea
  const merged = mergeIdeaAfterConflict(local, server)
  assert.equal(merged.priority, 'low')
  assert.equal(merged.size, 'small')
  assert.equal(merged.status, STATUS.RUNNING)
  assert.equal(merged.serviceId, 'chatgpt')
  assert.equal(merged.lastRunId, 'r9')
  assert.equal(merged.updatedAt, T2.toISOString())
})

test('mergeIdeaAfterConflict withdraws approval when contents diverged on the same contentVersion', () => {
  const base = makeIdea({}, T0)
  const server = editIdea(base, { text: 'Server edit' }, T1).idea // contentVersion 2
  const local = editIdea(base, { text: 'Local edit' }, T2).idea // contentVersion 2 as well
  const merged = mergeIdeaAfterConflict(local, server)
  assert.equal(merged.text, 'Local edit')
  assert.ok(merged.contentVersion > server.contentVersion)
})

test('stale shared policy, control and lease do not replace newer applied versions', () => {
  const policyV2 = defaultPolicy()
  policyV2.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const first = applySurplusRecords(emptySurplusState(), [item('surplus-policy', policyV2, { version: 2 })])
  const second = applySurplusRecords(first, [item('surplus-policy', defaultPolicy(), { version: 1 })])
  assert.equal(second.policy.providers[PA].surplusEnabled, true)

  const control = applySurplusRecords(emptySurplusState(), [
    item('surplus-control', { autoRunEnabled: false, updatedAt: '2026-11-03T12:00:00.000Z' }, { version: 3 }),
  ])
  const staleControl = applySurplusRecords(control, [
    item('surplus-control', { autoRunEnabled: true, updatedAt: '2026-11-03T09:00:00.000Z' }, { version: 2 }),
  ])
  assert.equal(staleControl.control.autoRunEnabled, false)
})

test('a local stop is not undone by an older shared control record', () => {
  const base = { ...emptySurplusState(), control: { autoRunEnabled: false, updatedAt: '2026-11-03T12:00:00.000Z' } }
  const out = applySurplusRecords(base, [item('surplus-control', { autoRunEnabled: true, updatedAt: '2026-11-03T09:00:00.000Z' })])
  assert.equal(out.control.autoRunEnabled, false)
})

test('a finalised run is read-only: later shared versions do not change it', () => {
  const finalised = runRecord({ status: 'completed', endedAt: '2026-11-03T10:30:00.000Z', output: 'done' })
  const base = { ...emptySurplusState(), runs: [finalised] }
  const out = applySurplusRecords(base, [item('run:r1', runRecord({ status: 'failed', endedAt: '2026-11-03T11:00:00.000Z' }), { version: 2 })])
  assert.deepEqual(out.runs, [finalised])
})

test('a running run is replaced by its finalised version', () => {
  const base = { ...emptySurplusState(), runs: [runRecord()] }
  const finalised = runRecord({ status: 'completed', endedAt: '2026-11-03T10:30:00.000Z', output: 'done' })
  const out = applySurplusRecords(base, [item('run:r1', finalised, { version: 2 })])
  assert.deepEqual(out.runs, [finalised])
})

test('cycle records upsert by service and reset date, keeping the later reading', () => {
  const older = cycleRecord({ lastWeeklyRemainingPct: 60, readAt: '2026-11-03T08:00:00.000Z' })
  const newer = cycleRecord({ lastWeeklyRemainingPct: 30, readAt: '2026-11-04T08:00:00.000Z' })
  const other = cycleRecord({ resetDate: '2026-11-17' })
  const base = { ...emptySurplusState(), cycles: [newer] }
  const out = applySurplusRecords(base, [item('cycle:claude:2026-11-10', older), item('cycle:claude:2026-11-17', other)])
  assert.equal(out.cycles.length, 2)
  assert.deepEqual(out.cycles.find((c) => c.resetDate === '2026-11-10'), newer)
  const flipped = applySurplusRecords({ ...emptySurplusState(), cycles: [older] }, [item('cycle:claude:2026-11-10', newer)])
  assert.deepEqual(flipped.cycles, [newer])
})

test('a shared record flagged deleted removes the local idea and run', () => {
  const idea = makeIdea()
  const base = { ...emptySurplusState(), ideas: [idea], runs: [runRecord()], recordIndex: { 'idea:i1': { id: 'x', version: 1 } } }
  const out = applySurplusRecords(base, [
    item('idea:i1', idea, { deleted_at: '2026-11-03T12:00:00.000Z' }),
    item('run:r1', runRecord(), { deleted_at: '2026-11-03T12:00:00.000Z' }),
  ])
  assert.deepEqual(out.ideas, [])
  assert.deepEqual(out.runs, [])
})
