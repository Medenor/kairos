import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWeeklySnapshot,
  getLocalWeekKey,
  mergeWeekSnapshots,
  recordWeeklySnapshot,
  retainWeeklySnapshots,
  snapshotsEquivalent,
  upsertCurrentWeekSnapshot,
} from './utils.js'
import { applySnapshotRecord } from './stateTransitions.js'
import {
  MONTHLY_ID, PAYG_ID, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleServices, sampleState,
} from './providers/fixtures/sampleProviders.js'
import { LEGACY_SNAPSHOT_V1 } from './providers/fixtures/legacyData.js'

const NOW = new Date(2026, 2, 4, 12, 0, 0)
const LATER = new Date(2026, 2, 4, 18, 0, 0)
const WS = 'workspace-1'
const providers = () => sampleServices()
const shiftDays = (date, days) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

test('writes schemaVersion 2 with a providers map: name, captured meta, reset date, quotas', () => {
  const snapshot = createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: NOW })
  assert.equal(snapshot.schemaVersion, 2)
  assert.equal(snapshot.weekKey, getLocalWeekKey(NOW).weekKey)
  assert.deepEqual(Object.keys(snapshot.providers).sort(), [MONTHLY_ID, PAYG_ID, WEEKLY_ID].sort())
  const entry = snapshot.providers[WEEKLY_ID]
  assert.equal(entry.providerId, WEEKLY_ID)
  assert.equal(entry.name, 'Alpha Weekly')
  assert.deepEqual(entry.captured, { color: '#378add', note: 'Weekly plan', flags: ['premium', 'multi-purpose'] })
  assert.equal(entry.lastResetDate, '2026-03-02')
  assert.deepEqual(entry.quotas[WEEKLY_Q_WEEK], {
    quotaId: WEEKLY_Q_WEEK, label: 'Weekly quota', type: 'consumed_pct', value: 40, currency: null, consumedPct: 40, subnote: null,
  })
  assert.equal(snapshot.providers[PAYG_ID].quotas.q_balance2.consumedPct, 20)
  assert.equal(snapshot.services, undefined, 'no legacy section when there is none')
})

test('a snapshot is a deep copy of the state', () => {
  const state = sampleState()
  const snapshot = createWeeklySnapshot({ workspaceId: WS, state, providers: providers(), now: NOW })
  state[WEEKLY_ID][WEEKLY_Q_WEEK] = 5
  state[WEEKLY_ID].__last_reset_date = '2026-01-01'
  assert.equal(snapshot.providers[WEEKLY_ID].quotas[WEEKLY_Q_WEEK].value, 40)
  assert.equal(snapshot.providers[WEEKLY_ID].lastResetDate, '2026-03-02')
})

test('a quota with no value yet is left out, never recorded as undefined, and appears with its first reading', () => {
  const state = sampleState()
  delete state[WEEKLY_ID][WEEKLY_Q_SESSION]
  state[MONTHLY_ID].q_monthly2 = null
  const first = createWeeklySnapshot({ workspaceId: WS, state, providers: providers(), now: NOW })
  assert.deepEqual(Object.keys(first.providers[WEEKLY_ID].quotas), [WEEKLY_Q_WEEK])
  assert.deepEqual(Object.keys(first.providers[MONTHLY_ID].quotas), [])
  assert.equal(JSON.stringify(first).includes('undefined'), false)
  state[WEEKLY_ID][WEEKLY_Q_SESSION] = 15
  const second = createWeeklySnapshot({ workspaceId: WS, state, providers: providers(), now: NOW })
  assert.equal(second.providers[WEEKLY_ID].quotas[WEEKLY_Q_SESSION].value, 15)
})

test('with zero providers recordWeeklySnapshot records nothing and returns the same history (FR-026)', () => {
  const history = []
  assert.equal(recordWeeklySnapshot(history, { workspaceId: WS, state: {}, providers: [], now: NOW }), history)
  const withLegacyOnly = recordWeeklySnapshot(history, { workspaceId: WS, state: {}, providers: [], removed: [], now: NOW })
  assert.deepEqual(withLegacyOnly, [])
})

test('a v1 snapshot of the same week is carried verbatim as `services` inside the v2 snapshot', () => {
  const v1 = { ...LEGACY_SNAPSHOT_V1, workspaceId: WS, weekKey: getLocalWeekKey(NOW).weekKey }
  const out = recordWeeklySnapshot([v1], { workspaceId: WS, state: sampleState(), providers: providers(), now: NOW })
  assert.equal(out.length, 1, 'one snapshot per workspace and week')
  assert.equal(out[0].schemaVersion, 2)
  assert.deepEqual(out[0].services, LEGACY_SNAPSHOT_V1.services)
  assert.ok(out[0].providers[WEEKLY_ID])
})

test('an entry of a removed provider is kept with removedAt in the current week', () => {
  const first = recordWeeklySnapshot([], { workspaceId: WS, state: sampleState(), providers: providers(), now: NOW })
  const remaining = providers().filter((p) => p.id !== MONTHLY_ID)
  const removed = [{ id: MONTHLY_ID, removedAt: LATER.toISOString() }]
  const out = recordWeeklySnapshot(first, { workspaceId: WS, state: sampleState(), providers: remaining, removed, now: LATER })
  const kept = out[0].providers[MONTHLY_ID]
  assert.equal(kept.removedAt, LATER.toISOString())
  assert.equal(kept.name, 'Beta Monthly')
  assert.equal(kept.quotas.q_monthly2.value, 30)
  assert.equal(out[0].providers[WEEKLY_ID].removedAt, undefined)
  // and stays on later records
  const again = recordWeeklySnapshot(out, { workspaceId: WS, state: sampleState(), providers: remaining, removed, now: LATER })
  assert.equal(again[0].providers[MONTHLY_ID].removedAt, LATER.toISOString())
})

test('an entry for an unknown provider (not removed here) is kept as received', () => {
  const remote = createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: NOW })
  const out = recordWeeklySnapshot([remote], { workspaceId: WS, state: sampleState(), providers: providers().slice(0, 1), now: LATER })
  assert.ok(out[0].providers[MONTHLY_ID], 'kept')
  assert.equal(out[0].providers[MONTHLY_ID].removedAt, undefined, 'not marked removed without a tombstone')
})

test('completed weeks are never rewritten by recording the current week', () => {
  const lastWeek = shiftDays(NOW, -7)
  const past = createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: lastWeek })
  const renamed = providers().map((p) => (p.id === WEEKLY_ID ? { ...p, name: 'Renamed' } : p))
  const out = recordWeeklySnapshot([past], { workspaceId: WS, state: sampleState(), providers: renamed, now: NOW })
  assert.equal(out.length, 2)
  assert.deepEqual(out.find((s) => s.weekKey === past.weekKey), past)
  assert.equal(out.find((s) => s.weekKey !== past.weekKey).providers[WEEKLY_ID].name, 'Renamed')
})

test('retention keeps 52 completed weeks and the current one', () => {
  const history = Array.from({ length: 60 }, (_, i) =>
    createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: shiftDays(NOW, -7 * i) }))
  const kept = retainWeeklySnapshots(history, { now: NOW })
  assert.equal(kept.length, 53)
  assert.ok(kept.every((s) => s.schemaVersion === 2))
})

test('snapshotsEquivalent ignores only capturedAt', () => {
  const a = createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: NOW })
  const b = createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: providers(), now: LATER })
  assert.equal(snapshotsEquivalent(a, b), true)
  const state = sampleState()
  state[WEEKLY_ID][WEEKLY_Q_WEEK] = 41
  assert.equal(snapshotsEquivalent(a, createWeeklySnapshot({ workspaceId: WS, state, providers: providers(), now: NOW })), false)
  const removedMark = recordWeeklySnapshot([a], { workspaceId: WS, state: sampleState(), providers: providers().slice(0, 2), removed: [{ id: PAYG_ID, removedAt: LATER.toISOString() }], now: LATER })
  assert.equal(snapshotsEquivalent(a, removedMark[0]), false)
})

// --- mergeWeekSnapshots -------------------------------------------------------------------

const snap = (providerSubset, now, extra = {}) => {
  const all = providers().filter((p) => providerSubset.includes(p.id))
  return { ...createWeeklySnapshot({ workspaceId: WS, state: sampleState(), providers: all, now }), ...extra }
}

test('merge is a union on provider id, the later capturedAt winning per provider', () => {
  const local = snap([WEEKLY_ID, MONTHLY_ID], NOW)
  const remote = snap([MONTHLY_ID, PAYG_ID], LATER)
  remote.providers[MONTHLY_ID] = { ...remote.providers[MONTHLY_ID], name: 'Remote name' }
  const merged = mergeWeekSnapshots(local, remote)
  assert.deepEqual(Object.keys(merged.providers).sort(), [MONTHLY_ID, PAYG_ID, WEEKLY_ID].sort())
  assert.equal(merged.providers[MONTHLY_ID].name, 'Remote name')
  assert.equal(merged.capturedAt, LATER.toISOString())
  const flipped = mergeWeekSnapshots(remote, local)
  assert.equal(flipped.providers[MONTHLY_ID].name, 'Remote name', 'order of arguments does not matter')
})

test('an entry with removedAt wins over one without, whichever is newer', () => {
  const removedLocal = snap([WEEKLY_ID, MONTHLY_ID], NOW)
  removedLocal.providers[MONTHLY_ID].removedAt = NOW.toISOString()
  const staleRemote = snap([WEEKLY_ID, MONTHLY_ID], LATER)
  const merged = mergeWeekSnapshots(removedLocal, staleRemote)
  assert.equal(merged.providers[MONTHLY_ID].removedAt, NOW.toISOString())
  assert.equal(mergeWeekSnapshots(staleRemote, removedLocal).providers[MONTHLY_ID].removedAt, NOW.toISOString())
})

test('a stale remote v1 snapshot arriving after local v2 entries drops nothing and keeps its legacy section', () => {
  const local = snap([WEEKLY_ID], LATER)
  const remoteV1 = { ...LEGACY_SNAPSHOT_V1, workspaceId: WS, weekKey: local.weekKey, capturedAt: NOW.toISOString() }
  const merged = mergeWeekSnapshots(local, remoteV1)
  assert.ok(merged.providers[WEEKLY_ID])
  assert.deepEqual(merged.services, LEGACY_SNAPSHOT_V1.services)
  assert.equal(merged.schemaVersion, 2)
})

test('a remote snapshot lacking a provider deleted locally this week keeps the removed entry', () => {
  const local = recordWeeklySnapshot([snap([WEEKLY_ID, MONTHLY_ID], NOW)], {
    workspaceId: WS, state: sampleState(), providers: providers().slice(0, 1), removed: [{ id: MONTHLY_ID, removedAt: LATER.toISOString() }], now: LATER,
  })[0]
  const remote = snap([WEEKLY_ID], new Date(LATER.getTime() + 60000))
  const merged = mergeWeekSnapshots(local, remote)
  assert.equal(merged.providers[MONTHLY_ID].removedAt, LATER.toISOString())
})

test('a remote snapshot with a provider unknown locally keeps it from its own data, no catalogue involved', () => {
  const local = snap([WEEKLY_ID], NOW)
  const remote = snap([PAYG_ID], LATER)
  const merged = mergeWeekSnapshots(local, remote)
  assert.equal(merged.providers[PAYG_ID].name, 'Gamma Credits')
})

test('upsertCurrentWeekSnapshot and applySnapshotRecord merge instead of replacing', () => {
  const local = snap([WEEKLY_ID], NOW)
  const remote = snap([MONTHLY_ID], LATER)
  const upserted = upsertCurrentWeekSnapshot([local], remote)
  assert.equal(upserted.length, 1)
  assert.deepEqual(Object.keys(upserted[0].providers).sort(), [MONTHLY_ID, WEEKLY_ID].sort())
  const applied = applySnapshotRecord([local], { record_type: 'snapshot', workspace_id: WS, payload: remote }, { now: LATER })
  assert.deepEqual(Object.keys(applied[0].providers).sort(), [MONTHLY_ID, WEEKLY_ID].sort())
})

test('merge does not mutate its inputs', () => {
  const local = snap([WEEKLY_ID], NOW)
  const remote = snap([MONTHLY_ID], LATER)
  const frozen = JSON.stringify([local, remote])
  mergeWeekSnapshots(local, remote)
  assert.equal(JSON.stringify([local, remote]), frozen)
})
