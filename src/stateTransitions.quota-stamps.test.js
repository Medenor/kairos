import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICES } from './data/services.js'
import {
  applyQuotaRecord,
  applyQuotaUpdate,
  buildDefaultState,
  confirmQuotas,
} from './stateTransitions.js'
import { QUOTA_TS_PREFIX, RESET_DATE_KEY, quotaTimeKey } from './utils.js'

const NOW = new Date('2026-11-03T09:15:00.000Z')
const LATER = new Date('2026-11-03T10:45:00.000Z')

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

test('buildDefaultState seeds a null stamp for every quota', () => {
  const state = buildDefaultState()
  for (const service of SERVICES) {
    for (const quota of service.quotas) {
      assert.equal(state[service.id][quotaTimeKey(quota.id)], null)
    }
  }
})

test('applyQuotaUpdate sets the value and stamps only that quota', () => {
  const base = deepFreeze(buildDefaultState())
  const next = applyQuotaUpdate(base, 'claude', 'weekly', 42, NOW)
  assert.equal(next.claude.weekly, 42)
  assert.equal(next.claude.__ts_weekly, NOW.toISOString())
  assert.equal(next.claude.__ts_slot5h, null)
  assert.equal(next.chatgpt.__ts_codex_5h, null)
  assert.equal(base.claude.weekly, 70)
  assert.equal(base.claude.__ts_weekly, null)
})

test('a later update restamps its quota and keeps the other stamps', () => {
  let state = applyQuotaUpdate(buildDefaultState(), 'claude', 'slot5h', 10, NOW)
  state = applyQuotaUpdate(state, 'claude', 'weekly', 50, LATER)
  assert.equal(state.claude.__ts_slot5h, NOW.toISOString())
  assert.equal(state.claude.__ts_weekly, LATER.toISOString())
})

test('updating the reset date does not create a stamp key', () => {
  const next = applyQuotaUpdate(buildDefaultState(), 'claude', RESET_DATE_KEY, '2026-11-09', NOW)
  assert.equal(next.claude[RESET_DATE_KEY], '2026-11-09')
  assert.equal(Object.keys(next.claude).some((key) => key.includes('__ts___')), false)
})

test('confirmQuotas stamps every quota of the service and changes no value', () => {
  const base = deepFreeze(applyQuotaUpdate(buildDefaultState(), 'chatgpt', 'codex_5h', 33, NOW))
  const next = confirmQuotas(base, 'chatgpt', LATER)
  for (const quota of SERVICES.find((s) => s.id === 'chatgpt').quotas) {
    assert.equal(next.chatgpt[quotaTimeKey(quota.id)], LATER.toISOString())
    assert.equal(next.chatgpt[quota.id], base.chatgpt[quota.id])
  }
  assert.equal(next.claude.__ts_weekly, null)
  assert.equal(next.chatgpt[RESET_DATE_KEY], null)
})

test('applyQuotaRecord applies a stamp record without restamping it', () => {
  const stamp = '2026-11-02T08:00:00.000Z'
  const next = applyQuotaRecord(buildDefaultState(), {
    record_type: 'quota_state',
    logical_key: 'claude:__ts_weekly',
    payload: { value: stamp },
  })
  assert.equal(next.claude.__ts_weekly, stamp)
  assert.equal(Object.keys(next.claude).some((key) => key.startsWith('__ts___ts_')), false)
})

test('applyQuotaRecord applies a value record without inventing a stamp', () => {
  const next = applyQuotaRecord(buildDefaultState(), {
    record_type: 'quota_state',
    logical_key: 'claude:weekly',
    payload: { value: 12 },
  })
  assert.equal(next.claude.weekly, 12)
  assert.equal(next.claude.__ts_weekly, null)
})
