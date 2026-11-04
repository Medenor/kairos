// T028: tests for src/surplus/cycleReadings.js (which weekly-quota stamps become cycle readings).
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCycleReadings, deriveCycleReadings } from './cycleReadings.js'

const NOW = new Date(2026, 10, 8, 14, 0, 0) // local Sunday 2026-11-08
const iso = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0, 0).toISOString()

const SERVICES = [
  {
    id: 'claude',
    resetCycleDays: 7,
    quotas: [{ id: 'weekly', type: 'consumed_pct' }, { id: 'slot5h', type: 'consumed_pct' }],
    surplus: { weeklyQuotaId: 'weekly', sessionQuotaId: 'slot5h', tool: 'claude' },
  },
  {
    id: 'chatgpt',
    resetCycleDays: 7,
    quotas: [{ id: 'codex_remaining', type: 'remaining_pct' }, { id: 'codex_5h', type: 'remaining_pct' }],
    surplus: { weeklyQuotaId: 'codex_remaining', sessionQuotaId: 'codex_5h', tool: 'codex' },
  },
  { id: 'copilot', resetCycleDays: 30, quotas: [{ id: 'premium', type: 'consumed_pct' }] },
]

function state(overrides = {}) {
  return {
    claude: { weekly: 60, slot5h: 10, __ts_weekly: iso(2026, 11, 8, 12), __last_reset_date: '2026-11-04' },
    chatgpt: { codex_remaining: 35, codex_5h: 50, __ts_codex_remaining: iso(2026, 11, 8, 11), __last_reset_date: '2026-11-05' },
    copilot: { premium: 20, __ts_premium: iso(2026, 11, 8, 12), __last_reset_date: '2026-11-01' },
    ...overrides,
  }
}

test('first call records every service with a stamp, value and valid reset date', () => {
  const { readings, stamps } = deriveCycleReadings(null, state(), SERVICES, NOW)
  assert.deepEqual(readings, [
    { serviceId: 'claude', nextResetDate: '2026-11-11', weeklyRemainingPct: 40, readAt: iso(2026, 11, 8, 12) },
    { serviceId: 'chatgpt', nextResetDate: '2026-11-12', weeklyRemainingPct: 35, readAt: iso(2026, 11, 8, 11) },
  ])
  assert.deepEqual(stamps, { claude: iso(2026, 11, 8, 12), chatgpt: iso(2026, 11, 8, 11) })
})

test('nothing is recorded when no stamp changed', () => {
  const first = deriveCycleReadings(null, state(), SERVICES, NOW)
  const second = deriveCycleReadings(first.stamps, state(), SERVICES, NOW)
  assert.deepEqual(second.readings, [])
  assert.deepEqual(second.stamps, first.stamps)
})

test('only the service whose weekly stamp changed is recorded (value entered or still current)', () => {
  const first = deriveCycleReadings(null, state(), SERVICES, NOW)
  const next = state()
  next.claude = { ...next.claude, __ts_weekly: iso(2026, 11, 8, 13) }
  next.chatgpt = { ...next.chatgpt, codex_5h: 10, __ts_codex_5h: iso(2026, 11, 8, 13) } // session quota only
  const { readings } = deriveCycleReadings(first.stamps, next, SERVICES, NOW)
  assert.deepEqual(readings, [
    { serviceId: 'claude', nextResetDate: '2026-11-11', weeklyRemainingPct: 40, readAt: iso(2026, 11, 8, 13) },
  ])
})

test('skips services without a valid reset date, value, stamp or surplus block', () => {
  const s = state()
  s.claude = { ...s.claude, __last_reset_date: null }
  s.chatgpt = { ...s.chatgpt, codex_remaining: null }
  assert.deepEqual(deriveCycleReadings(null, s, SERVICES, NOW).readings, [])
  s.claude = { ...state().claude, __last_reset_date: '2026-12-01' } // in the future: invalid
  assert.deepEqual(deriveCycleReadings(null, s, SERVICES, NOW).readings, [])
  s.claude = { ...state().claude, __ts_weekly: null }
  const { readings, stamps } = deriveCycleReadings(null, s, SERVICES, NOW)
  assert.deepEqual(readings, [])
  assert.deepEqual(Object.keys(stamps), ['chatgpt'])
})

test('a reset date entered after the stamp is picked up on the next stamp change', () => {
  const s = state()
  s.claude = { ...s.claude, __last_reset_date: null }
  const first = deriveCycleReadings(null, s, SERVICES, NOW)
  assert.equal(first.readings.some((r) => r.serviceId === 'claude'), false)
  const confirmed = state()
  confirmed.claude = { ...confirmed.claude, __ts_weekly: iso(2026, 11, 8, 13) }
  const { readings } = deriveCycleReadings(first.stamps, confirmed, SERVICES, NOW)
  assert.equal(readings.find((r) => r.serviceId === 'claude').weeklyRemainingPct, 40)
})

test('ignores a stamp in the future and an unparseable stamp', () => {
  const s = state()
  s.claude = { ...s.claude, __ts_weekly: iso(2026, 11, 9, 12) }
  s.chatgpt = { ...s.chatgpt, __ts_codex_remaining: 'not a date' }
  assert.deepEqual(deriveCycleReadings(null, s, SERVICES, NOW).readings, [])
})

test('remaining percentage is clamped to 0..100', () => {
  const s = state()
  s.claude = { ...s.claude, weekly: 140 }
  s.chatgpt = { ...s.chatgpt, codex_remaining: 100 }
  const { readings } = deriveCycleReadings(null, s, SERVICES, NOW)
  assert.deepEqual(readings.map((r) => r.weeklyRemainingPct), [0, 100])
})

test('does not mutate its inputs', () => {
  const s = state()
  const snapshot = JSON.stringify(s)
  deriveCycleReadings({ claude: 'x' }, s, SERVICES, NOW)
  assert.equal(JSON.stringify(s), snapshot)
})

test('applyCycleReadings creates the cycle record and returns the same array when nothing changes', () => {
  const { readings } = deriveCycleReadings(null, state(), SERVICES, NOW)
  const cycles = applyCycleReadings([], readings)
  assert.deepEqual(cycles, [
    { serviceId: 'chatgpt', resetDate: '2026-11-12', lastWeeklyRemainingPct: 35, readAt: iso(2026, 11, 8, 11) },
    { serviceId: 'claude', resetDate: '2026-11-11', lastWeeklyRemainingPct: 40, readAt: iso(2026, 11, 8, 12) },
  ])
  assert.equal(applyCycleReadings(cycles, readings), cycles)
})

test('applyCycleReadings keeps the latest reading and replaces on a newer one', () => {
  const cycles = applyCycleReadings([], [
    { serviceId: 'claude', nextResetDate: '2026-11-11', weeklyRemainingPct: 40, readAt: iso(2026, 11, 8, 12) },
  ])
  const older = applyCycleReadings(cycles, [
    { serviceId: 'claude', nextResetDate: '2026-11-11', weeklyRemainingPct: 70, readAt: iso(2026, 11, 8, 9) },
  ])
  assert.equal(older, cycles)
  const newer = applyCycleReadings(cycles, [
    { serviceId: 'claude', nextResetDate: '2026-11-11', weeklyRemainingPct: 25, readAt: iso(2026, 11, 9, 9) },
  ])
  assert.equal(newer[0].lastWeeklyRemainingPct, 25)
})
