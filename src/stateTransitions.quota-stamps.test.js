import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyQuotaRecord,
  applyQuotaUpdate,
  buildDefaultState,
  confirmQuotas,
} from './stateTransitions.js'
import { QUOTA_TS_PREFIX, RESET_DATE_KEY, quotaTimeKey } from './utils.js'
import {
  MONTHLY_ID, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleServices,
} from './providers/fixtures/sampleProviders.js'
import { LEGACY_STATE } from './providers/fixtures/legacyData.js'

const NOW = new Date('2026-11-03T09:15:00.000Z')
const LATER = new Date('2026-11-03T10:45:00.000Z')
const SERVICES = sampleServices()

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('quotaTimeKey prefixes the quota id with __ts_', () => {
  assert.equal(QUOTA_TS_PREFIX, '__ts_')
  assert.equal(quotaTimeKey('weekly'), '__ts_weekly')
})

test('buildDefaultState pre-fills nothing: no provider gives an empty state (FR-001)', () => {
  assert.deepEqual(buildDefaultState(), {})
  assert.deepEqual(buildDefaultState([]), {})
})

test('buildDefaultState seeds unread quotas with a null value and a null stamp', () => {
  const state = buildDefaultState(SERVICES)
  for (const service of SERVICES) {
    for (const quota of service.quotas) {
      assert.equal(state[service.id][quota.id], null)
      assert.equal(state[service.id][quotaTimeKey(quota.id)], null)
    }
    assert.equal(state[service.id][RESET_DATE_KEY], null)
  }
})

test('applyQuotaUpdate sets the value and stamps only that quota', () => {
  const base = deepFreeze(buildDefaultState(SERVICES))
  const next = applyQuotaUpdate(base, WEEKLY_ID, WEEKLY_Q_WEEK, 42, NOW)
  assert.equal(next[WEEKLY_ID][WEEKLY_Q_WEEK], 42)
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_WEEK)], NOW.toISOString())
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_SESSION)], null)
  assert.equal(next[MONTHLY_ID][quotaTimeKey('q_monthly2')], null)
  assert.equal(base[WEEKLY_ID][WEEKLY_Q_WEEK], null)
})

test('a later update restamps its quota and keeps the other stamps', () => {
  let state = applyQuotaUpdate(buildDefaultState(SERVICES), WEEKLY_ID, WEEKLY_Q_SESSION, 10, NOW)
  state = applyQuotaUpdate(state, WEEKLY_ID, WEEKLY_Q_WEEK, 50, LATER)
  assert.equal(state[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_SESSION)], NOW.toISOString())
  assert.equal(state[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_WEEK)], LATER.toISOString())
})

test('updating the reset date does not create a stamp key', () => {
  const next = applyQuotaUpdate(buildDefaultState(SERVICES), WEEKLY_ID, RESET_DATE_KEY, '2026-11-09', NOW)
  assert.equal(next[WEEKLY_ID][RESET_DATE_KEY], '2026-11-09')
  assert.equal(Object.keys(next[WEEKLY_ID]).some((key) => key.includes('__ts___')), false)
})

test('confirmQuotas stamps every quota that has a reading and changes no value', () => {
  let base = applyQuotaUpdate(buildDefaultState(SERVICES), WEEKLY_ID, WEEKLY_Q_SESSION, 33, NOW)
  base = deepFreeze(applyQuotaUpdate(base, WEEKLY_ID, WEEKLY_Q_WEEK, 12, NOW))
  const next = confirmQuotas(base, WEEKLY_ID, LATER, SERVICES)
  for (const quota of SERVICES.find((s) => s.id === WEEKLY_ID).quotas) {
    assert.equal(next[WEEKLY_ID][quotaTimeKey(quota.id)], LATER.toISOString())
    assert.equal(next[WEEKLY_ID][quota.id], base[WEEKLY_ID][quota.id])
  }
  assert.equal(next[MONTHLY_ID][quotaTimeKey('q_monthly2')], null)
  assert.equal(next[WEEKLY_ID][RESET_DATE_KEY], null)
})

test('confirmQuotas leaves a quota that was never read unread (no value, no stamp)', () => {
  const base = deepFreeze(applyQuotaUpdate(buildDefaultState(SERVICES), WEEKLY_ID, WEEKLY_Q_SESSION, 33, NOW))
  const next = confirmQuotas(base, WEEKLY_ID, LATER, SERVICES)
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_SESSION)], LATER.toISOString())
  assert.equal(next[WEEKLY_ID][WEEKLY_Q_WEEK], null)
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_WEEK)], null)
})

test('confirmQuotas of an unknown provider changes nothing', () => {
  const base = buildDefaultState(SERVICES)
  assert.equal(confirmQuotas(base, 'p_unknownzzzzz', LATER, SERVICES), base)
  assert.equal(confirmQuotas(base, WEEKLY_ID, LATER), base, 'no providers given: nothing to confirm')
})

test('applyQuotaRecord applies a stamp record without restamping it', () => {
  const stamp = '2026-11-02T08:00:00.000Z'
  const next = applyQuotaRecord(buildDefaultState(SERVICES), {
    record_type: 'quota_state',
    logical_key: `${WEEKLY_ID}:__ts_${WEEKLY_Q_WEEK}`,
    payload: { value: stamp },
  })
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_WEEK)], stamp)
  assert.equal(Object.keys(next[WEEKLY_ID]).some((key) => key.startsWith('__ts___ts_')), false)
})

test('applyQuotaRecord applies a value record without inventing a stamp', () => {
  const next = applyQuotaRecord(buildDefaultState(SERVICES), {
    record_type: 'quota_state',
    logical_key: `${WEEKLY_ID}:${WEEKLY_Q_WEEK}`,
    payload: { value: 12 },
  })
  assert.equal(next[WEEKLY_ID][WEEKLY_Q_WEEK], 12)
  assert.equal(next[WEEKLY_ID][quotaTimeKey(WEEKLY_Q_WEEK)], null)
})

test('entries of former ids survive every transition untouched (FR-022)', () => {
  let state = deepFreeze(structuredClone(LEGACY_STATE))
  state = applyQuotaUpdate(state, WEEKLY_ID, WEEKLY_Q_WEEK, 5, NOW)
  state = confirmQuotas(state, WEEKLY_ID, LATER, SERVICES)
  state = applyQuotaRecord(state, { record_type: 'quota_state', logical_key: `${MONTHLY_ID}:q_monthly2`, payload: { value: 1 } })
  for (const [legacyId, entry] of Object.entries(LEGACY_STATE)) assert.deepEqual(state[legacyId], entry)
})
