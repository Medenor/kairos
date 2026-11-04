import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS } from './constants.js'
import { defaultPolicy, defaultProviderSurplus } from './policy.js'
import { emptySurplusState } from './storage.js'
import {
  addIdea,
  archiveIdea,
  decideRun,
  deleteIdea,
  diffDirty,
  dropRemoteDeleted,
  makeUuid,
  markLaunchedManually,
  payloadFor,
  remoteDeletedKeys,
  reorder,
  requestApproval,
  resolveControlConflict,
  resolveCycleConflict,
  setControl,
  sortIdeas,
  unsyncedLocalKeys,
  updateIdea,
  updatePolicy,
} from './store.js'

const PA = 'p_claudeaaaaaa'

const T0 = new Date('2026-11-03T10:00:00.000Z')
const T1 = new Date('2026-11-03T11:00:00.000Z')

function withIdeas(...texts) {
  let state = emptySurplusState()
  texts.forEach((text, i) => {
    const r = addIdea(state, { text }, { id: `i${i + 1}`, now: T0 })
    assert.equal(r.ok, true)
    state = r.state
  })
  return state
}

test('addIdea appends in order, rejects empty text and duplicate ids, and does not mutate', () => {
  const base = emptySurplusState()
  const a = addIdea(base, { text: 'one' }, { id: 'a', now: T0 })
  const b = addIdea(a.state, { text: 'two', priority: 'high' }, { id: 'b', now: T0 })
  assert.equal(base.ideas.length, 0)
  assert.deepEqual(b.state.ideas.map((i) => i.order), [1, 2])
  assert.equal(addIdea(a.state, { text: '  ' }, { id: 'c', now: T0 }).error.code, 'text_required')
  assert.equal(addIdea(a.state, { text: 'x' }, { id: 'a', now: T0 }).error.code, 'id_in_use')
})

test('sortIdeas orders by priority, then manual order, then creation', () => {
  let s = withIdeas('n1', 'n2', 'n3')
  s = updateIdea(s, 'i3', { priority: 'high' }, T1).state
  s = updateIdea(s, 'i1', { priority: 'low' }, T1).state
  assert.deepEqual(sortIdeas(s.ideas).map((i) => i.id), ['i3', 'i2', 'i1'])
})

test('updateIdea withdraws approval on content edits only and keeps untouched ideas by reference', () => {
  const s = withIdeas('one', 'two')
  const content = updateIdea(s, 'i1', { text: 'changed' }, T1)
  assert.equal(content.approvalWithdrawn, true)
  assert.equal(content.idea.contentVersion, 2)
  assert.equal(content.state.ideas[1], s.ideas[1])
  const meta = updateIdea(s, 'i1', { priority: 'high' }, T1)
  assert.equal(meta.approvalWithdrawn, false)
  assert.equal(updateIdea(s, 'nope', {}, T1).error.code, 'idea_not_found')
  assert.equal(updateIdea(s, 'i1', { text: '' }, T1).ok, false)
})

test('requestApproval sets the request flag only', () => {
  const r = requestApproval(withIdeas('one'), 'i1', T1)
  assert.equal(r.idea.approvalRequested, true)
  assert.equal(r.idea.contentVersion, 1)
})

test('reorder renumbers, reports unknown ids', () => {
  const s = withIdeas('a', 'b', 'c')
  const r = reorder(s, ['i3', 'i1', 'i2'], T1)
  assert.deepEqual(sortIdeas(r.state.ideas).map((i) => i.id), ['i3', 'i1', 'i2'])
  assert.equal(reorder(s, ['zzz'], T1).error.code, 'reorder_invalid')
})

test('archive and markLaunchedManually follow the state diagram, with errors instead of throws', () => {
  const s = withIdeas('a')
  const launched = markLaunchedManually(s, 'i1', 'claude', T1)
  assert.equal(launched.idea.status, STATUS.LAUNCHED_MANUALLY)
  assert.equal(launched.idea.serviceId, 'claude')
  assert.equal(markLaunchedManually(s, 'i1', 'gemini', T1).ok, false)
  assert.equal(archiveIdea(s, 'i1', T1).idea.status, STATUS.ARCHIVED)
  const archived = archiveIdea(s, 'i1', T1).state
  assert.equal(archiveIdea(archived, 'i1', T1).error.code, 'transition_invalid')
})

test('decideRun changes only the idea and reports unknown ideas and invalid decisions', () => {
  const s = withIdeas('a', 'b')
  const completed = {
    ...s,
    ideas: s.ideas.map((i) => (i.id === 'i1' ? { ...i, status: STATUS.COMPLETED, lastRunId: 'r1' } : i)),
  }
  const accepted = decideRun(completed, 'i1', 'accepted', T1)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.idea.status, STATUS.ARCHIVED)
  assert.equal(accepted.state.ideas[1], completed.ideas[1])
  assert.equal(accepted.state.runs, completed.runs)
  assert.equal(decideRun(completed, 'nope', 'accepted', T1).error.code, 'idea_not_found')
  assert.equal(decideRun(s, 'i1', 'accepted', T1).ok, false)
})

test('deleteIdea removes the idea and refuses a running one', () => {
  const s = withIdeas('a', 'b')
  assert.deepEqual(deleteIdea(s, 'i1').state.ideas.map((i) => i.id), ['i2'])
  const running = { ...s, ideas: s.ideas.map((i) => (i.id === 'i1' ? { ...i, status: STATUS.RUNNING } : i)) }
  assert.equal(deleteIdea(running, 'i1').error.code, 'idea_running')
  assert.equal(deleteIdea(s, 'zz').error.code, 'idea_not_found')
})

test('updatePolicy validates, accepts an updater and keeps the reference when nothing changed', () => {
  const s = emptySurplusState()
  const ok = updatePolicy(s, (p) => ({ ...p, providers: { ...p.providers, [PA]: { ...defaultProviderSurplus(), reservePct: 30 } } }))
  assert.equal(ok.ok, true)
  assert.equal(ok.state.policy.providers[PA].reservePct, 30)
  const bad = updatePolicy(s, (p) => ({ ...p, providers: { ...p.providers, [PA]: { ...defaultProviderSurplus(), autoRunEnabled: true } } }))
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'policy_invalid')
  assert.ok(bad.errors.length > 0)
  assert.equal(updatePolicy(s, defaultPolicy()).state, s)
})

test('setControl writes the control record with the given time', () => {
  const r = setControl(emptySurplusState(), false, T1)
  assert.deepEqual(r.state.control, { autoRunEnabled: false, updatedAt: T1.toISOString() })
})

test('diffDirty reports changed, added and removed browser-owned records only', () => {
  const s = withIdeas('a', 'b')
  const edited = updateIdea(s, 'i1', { priority: 'high' }, T1).state
  assert.deepEqual(diffDirty(s, edited), [{ logicalKey: 'idea:i1', op: 'upsert' }])
  assert.deepEqual(diffDirty(s, deleteIdea(s, 'i2').state), [{ logicalKey: 'idea:i2', op: 'delete' }])
  const added = addIdea(s, { text: 'c' }, { id: 'i3', now: T1 }).state
  assert.deepEqual(diffDirty(s, added), [{ logicalKey: 'idea:i3', op: 'upsert' }])
  assert.deepEqual(diffDirty(s, { ...s, runs: [{ id: 'r' }], lease: { x: 1 } }), [])
  assert.deepEqual(diffDirty(s, updatePolicy(s, (p) => ({ ...p, projectsBaseFolder: '/p' })).state), [{ logicalKey: 'surplus-policy', op: 'upsert' }])
  assert.deepEqual(diffDirty(s, setControl(s, false, T1).state), [{ logicalKey: 'surplus-control', op: 'upsert' }])
  const cycle = { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 40, readAt: T0.toISOString() }
  assert.deepEqual(diffDirty(s, { ...s, cycles: [cycle] }), [{ logicalKey: 'cycle:claude:2026-11-10', op: 'upsert' }])
  assert.deepEqual(diffDirty({ ...s, cycles: [cycle] }, { ...s, cycles: [cycle] }), [])
})

test('payloadFor resolves each browser-owned logical key and null for gone or foreign keys', () => {
  const s = withIdeas('a')
  assert.equal(payloadFor(s, 'idea:i1'), s.ideas[0])
  assert.equal(payloadFor(s, 'idea:zz'), null)
  assert.equal(payloadFor(s, 'surplus-policy'), s.policy)
  assert.equal(payloadFor(s, 'run:r1'), null)
  assert.equal(payloadFor(s, 'other'), null)
})

test('unsyncedLocalKeys lists local records missing from the record index', () => {
  const s = withIdeas('a', 'b')
  assert.deepEqual(unsyncedLocalKeys(s).sort(), ['idea:i1', 'idea:i2'])
  const indexed = { ...s, recordIndex: { 'idea:i1': { id: 'r', version: 1 } } }
  assert.deepEqual(unsyncedLocalKeys(indexed), ['idea:i2'])
  const touched = updatePolicy(indexed, (p) => ({ ...p, projectsBaseFolder: '/p' })).state
  assert.ok(unsyncedLocalKeys(touched).includes('surplus-policy'))
})

test('remote deletes are found by diffing a full pull against the held index', () => {
  const s = withIdeas('a', 'b')
  const index = {
    'idea:i1': { id: 'r1', version: 2 },
    'idea:i2': { id: 'r2', version: 1 },
    'surplus-policy': { id: 'r3', version: 1 },
    'runner-lease': { id: 'r4', version: 1 },
  }
  const pulled = [{ record_type: 'routing_config', logical_key: 'idea:i2' }, { record_type: 'quota_state', logical_key: 'idea:i1' }]
  const gone = remoteDeletedKeys(index, pulled)
  assert.deepEqual(gone, ['idea:i1'])
  const next = dropRemoteDeleted({ ...s, recordIndex: index }, gone)
  assert.deepEqual(next.ideas.map((i) => i.id), ['i2'])
  assert.equal(next.recordIndex['idea:i1'], undefined)
  assert.equal(dropRemoteDeleted(s, []), s)
})

test('control conflict: newer wins, a stop wins at equal time', () => {
  const stop = { autoRunEnabled: false, updatedAt: T0.toISOString() }
  const go = { autoRunEnabled: true, updatedAt: T0.toISOString() }
  const later = { autoRunEnabled: true, updatedAt: T1.toISOString() }
  assert.equal(resolveControlConflict(stop, go).winner, 'local')
  assert.equal(resolveControlConflict(go, stop).winner, 'server')
  assert.equal(resolveControlConflict(later, stop).winner, 'local')
  assert.equal(resolveControlConflict(stop, later).winner, 'server')
})

test('cycle conflict keeps the later reading', () => {
  const a = { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 30, readAt: T0.toISOString() }
  const b = { ...a, lastWeeklyRemainingPct: 20, readAt: T1.toISOString() }
  assert.equal(resolveCycleConflict(a, b).winner, 'server')
  assert.equal(resolveCycleConflict(b, a).winner, 'local')
})

test('makeUuid uses randomUUID, falls back to getRandomValues and Math.random, ids are v4-shaped and unique', () => {
  assert.equal(makeUuid({ randomUUID: () => 'fixed' }), 'fixed')
  const viaValues = makeUuid({ getRandomValues: (bytes) => bytes.fill(7) })
  assert.match(viaValues, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  const ids = new Set(Array.from({ length: 50 }, () => makeUuid(undefined)))
  assert.equal(ids.size, 50)
  assert.match([...ids][0], /^[0-9a-f]{8}-[0-9a-f]{4}-4/)
})
