import test from 'node:test'
import assert from 'node:assert/strict'
import { createWeeklySnapshot, deriveProviderHistorySeries, getLocalWeekKey, recordWeeklySnapshot } from './utils.js'
import { toTombstone } from './providers/records.js'
import { emptyCatalogue } from './providers/records.js'
import {
  MONTHLY_ID, PAYG_ID, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleCatalogue, sampleMonthly, sampleServices, sampleState,
} from './providers/fixtures/sampleProviders.js'
import { LEGACY_SNAPSHOT_V1 } from './providers/fixtures/legacyData.js'

const WS = 'ws'
const WEEK0 = new Date(2026, 2, 4, 12) // current
const WEEK_1 = new Date(2026, 1, 25, 12)
const WEEK_2 = new Date(2026, 1, 18, 12)
const key = (date) => getLocalWeekKey(date).weekKey
const snap = (providers, now, state = sampleState()) => createWeeklySnapshot({ workspaceId: WS, state, providers, now })
const range = (from, to) => ({ fromWeekKey: key(from), toWeekKey: key(to) })

test('a rename continues one series under the current name; earlier entries keep the captured one', () => {
  const before = sampleServices()
  const after = before.map((p) => (p.id === WEEKLY_ID ? { ...p, name: 'Alpha Renamed' } : p))
  const history = [snap(before, WEEK_1), snap(after, WEEK0)]
  const series = deriveProviderHistorySeries({ history, providerId: WEEKLY_ID, providers: after, ...range(WEEK_1, WEEK0) })
  assert.equal(series.displayName, 'Alpha Renamed')
  assert.equal(series.removed, false)
  assert.deepEqual(series.entries.map((e) => e.status), ['recorded', 'recorded'])
  assert.equal(series.entries[0].capturedName, 'Alpha Weekly')
  assert.equal(series.entries[1].capturedName, 'Alpha Renamed')
  assert.equal(series.hasEnoughHistoryForTrends, true)
})

test('weeks before the provider existed are missing_service with the documented message, never zero values', () => {
  const only = sampleServices().filter((p) => p.id !== PAYG_ID)
  const history = [snap(only, WEEK_2), snap(sampleServices(), WEEK0)]
  const series = deriveProviderHistorySeries({ history, providerId: PAYG_ID, providers: sampleServices(), ...range(WEEK_2, WEEK0) })
  assert.deepEqual(series.entries.map((e) => e.status), ['missing_service', 'missing_week', 'recorded'])
  assert.equal(series.entries[0].message, 'No history recorded for this provider this week')
  assert.deepEqual(series.entries[0].quotas, [])
})

test('a removed provider keeps the name it was recorded with, flagged removed, including the current week', () => {
  const first = recordWeeklySnapshot([], { workspaceId: WS, state: sampleState(), providers: sampleServices(), now: WEEK_1 })
  const live = sampleServices().filter((p) => p.id !== MONTHLY_ID)
  const removed = [{ id: MONTHLY_ID, removedAt: WEEK0.toISOString() }]
  const history = recordWeeklySnapshot(
    recordWeeklySnapshot(first, { workspaceId: WS, state: sampleState(), providers: sampleServices(), now: WEEK0 }),
    { workspaceId: WS, state: sampleState(), providers: live, removed, now: WEEK0 },
  )
  const catalogue = sampleCatalogue()
  catalogue.providers[MONTHLY_ID] = toTombstone(sampleMonthly(), WEEK0.toISOString())
  const series = deriveProviderHistorySeries({ history, providerId: MONTHLY_ID, providers: live, catalogue, ...range(WEEK_1, WEEK0) })
  assert.equal(series.removed, true)
  assert.equal(series.displayName, 'Beta Monthly')
  assert.deepEqual(series.entries.map((e) => e.status), ['recorded', 'recorded'])
  const current = series.entries.at(-1)
  assert.equal(current.status, 'recorded')
  assert.equal(current.removedAt, WEEK0.toISOString())
  assert.equal(current.capturedName, 'Beta Monthly')
})

test('a quota removed or retyped later keeps earlier entries with the type each was captured with', () => {
  const before = sampleServices()
  const after = before.map((p) =>
    p.id === WEEKLY_ID
      ? { ...p, quotas: [{ ...p.quotas[0], type: 'remaining_pct' }] } // session quota removed, weekly retyped
      : p)
  const history = [snap(before, WEEK_1), snap(after, WEEK0, { ...sampleState(), [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 70, __last_reset_date: null } })]
  const series = deriveProviderHistorySeries({ history, providerId: WEEKLY_ID, providers: after, ...range(WEEK_1, WEEK0) })
  const old = series.entries[0].quotas
  const cur = series.entries[1].quotas
  assert.deepEqual(old.map((q) => [q.quotaId, q.type]), [[WEEKLY_Q_WEEK, 'consumed_pct'], [WEEKLY_Q_SESSION, 'consumed_pct']])
  assert.deepEqual(cur.map((q) => [q.quotaId, q.type, q.consumedPct]), [[WEEKLY_Q_WEEK, 'remaining_pct', 30]])
})

test('a legacy id from the previous version returns a read-only series marked removed, with its legacy name', () => {
  const history = [{ ...LEGACY_SNAPSHOT_V1, workspaceId: WS }]
  const week = LEGACY_SNAPSHOT_V1.weekKey
  const series = deriveProviderHistorySeries({ history, providerId: 'claude', providers: sampleServices(), fromWeekKey: week, toWeekKey: week })
  assert.equal(series.legacy, true)
  assert.equal(series.removed, true)
  assert.equal(series.displayName, 'Claude')
  assert.equal(series.entries[0].status, 'recorded')
  assert.ok(series.entries[0].quotas.length > 0)
})

test('a snapshot mentioning an unknown provider yields a series from its own data without any catalogue change', () => {
  const catalogue = emptyCatalogue()
  const frozen = JSON.stringify(catalogue)
  const history = [snap(sampleServices(), WEEK0)]
  const series = deriveProviderHistorySeries({ history, providerId: WEEKLY_ID, providers: [], catalogue, ...range(WEEK0, WEEK0) })
  assert.equal(series.removed, true)
  assert.equal(series.displayName, 'Alpha Weekly')
  assert.equal(series.entries[0].status, 'recorded')
  assert.equal(JSON.stringify(catalogue), frozen)
})

test('a provider id found nowhere resolves to itself without throwing; invalid ranges give an empty series', () => {
  const series = deriveProviderHistorySeries({ history: [], providerId: 'p_nothingzzzzz', providers: [] })
  assert.deepEqual(series.entries, [])
  assert.equal(series.displayName, 'p_nothingzzzzz')
  assert.equal(series.recordedWeekCount, 0)
})
