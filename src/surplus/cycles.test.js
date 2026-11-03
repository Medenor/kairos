// T019: tests for src/surplus/cycles.js (implemented by T020, which also needs time.js `resetDayStart`).
//
// API under test (all pure; `readAt` and record timestamps are ISO strings; `now` is a Date):
//
//   recordCycleReading(cycles, { serviceId, nextResetDate, weeklyRemainingPct, readAt }) -> CycleRecord[]
//     `cycles` is an array of cycle records { serviceId, resetDate, lastWeeklyRemainingPct, readAt }.
//     Returns a NEW array (input never mutated) sorted by serviceId then resetDate. The record for
//     (serviceId, nextResetDate) is created or replaced when readAt is before resetDayStart(nextResetDate)
//     and not older than the stored readAt. Otherwise (reading on or after the reset day start, older than
//     the stored reading, or invalid input) the cycles are returned unchanged (deep-equal).
//
//   summariseCycles({ cycles, runs, serviceId, now, freshnessHours = DEFAULTS.FRESHNESS_HOURS })
//     -> { serviceId, status: 'ok' | 'history_too_short', cycles: CycleSummary[] }
//     Only closed cycles of `serviceId` count: resetDayStart(resetDate) <= now. Summaries are sorted most
//     recent reset first. Fewer than one closed cycle gives status 'history_too_short' and cycles [].
//     CycleSummary = { cycleKey, serviceId, resetDate, quotaLeftAtResetPct, readingAgeHoursAtReset,
//                      approximate, consumedByRunsPct }
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordCycleReading, summariseCycles } from './cycles.js'

// Local-time helpers: the reset day starts at local midnight, so tests build local dates.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).toISOString()

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function reading(overrides = {}) {
  return {
    serviceId: 'claude',
    nextResetDate: '2026-11-10',
    weeklyRemainingPct: 40,
    readAt: local(2026, 11, 8, 12),
    ...overrides,
  }
}

test('recordCycleReading creates the cycle record from the first reading', () => {
  const next = recordCycleReading([], reading())
  assert.deepEqual(next, [
    { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 40, readAt: local(2026, 11, 8, 12) },
  ])
})

test('recordCycleReading keeps the last reading taken before the reset day starts', () => {
  let cycles = recordCycleReading([], reading({ weeklyRemainingPct: 40, readAt: local(2026, 11, 8, 12) }))
  cycles = recordCycleReading(cycles, reading({ weeklyRemainingPct: 35, readAt: local(2026, 11, 9, 23, 59) }))
  assert.equal(cycles.length, 1)
  assert.equal(cycles[0].lastWeeklyRemainingPct, 35)
  assert.equal(cycles[0].readAt, local(2026, 11, 9, 23, 59))
})

test('recordCycleReading ignores a reading taken on or after the reset day start', () => {
  const start = recordCycleReading([], reading({ weeklyRemainingPct: 35, readAt: local(2026, 11, 9, 20) }))
  deepFreeze(start)
  for (const readAt of [local(2026, 11, 10, 0, 0), local(2026, 11, 10, 8), local(2026, 11, 12)]) {
    assert.deepEqual(recordCycleReading(start, reading({ weeklyRemainingPct: 90, readAt })), start)
  }
  assert.deepEqual(recordCycleReading([], reading({ readAt: local(2026, 11, 10, 8) })), [])
})

test('recordCycleReading ignores a reading older than the stored one', () => {
  const start = deepFreeze(recordCycleReading([], reading({ weeklyRemainingPct: 35, readAt: local(2026, 11, 9, 20) })))
  assert.deepEqual(recordCycleReading(start, reading({ weeklyRemainingPct: 50, readAt: local(2026, 11, 8, 8) })), start)
})

test('recordCycleReading tracks cycles per service and per reset date, sorted, without mutating input', () => {
  const base = deepFreeze(recordCycleReading([], reading({ serviceId: 'chatgpt', nextResetDate: '2026-11-12', readAt: local(2026, 11, 8, 9) })))
  let cycles = recordCycleReading(base, reading())
  cycles = recordCycleReading(cycles, reading({ nextResetDate: '2026-11-17', weeklyRemainingPct: 90, readAt: local(2026, 11, 9) }))
  assert.deepEqual(
    cycles.map((c) => `${c.serviceId}:${c.resetDate}`),
    ['chatgpt:2026-11-12', 'claude:2026-11-10', 'claude:2026-11-17'],
  )
  assert.equal(base.length, 1)
})

test('recordCycleReading ignores invalid readings', () => {
  const start = deepFreeze(recordCycleReading([], reading()))
  const invalid = [
    { serviceId: 'gemini' },
    { nextResetDate: 'soon' },
    { nextResetDate: null },
    { weeklyRemainingPct: NaN },
    { weeklyRemainingPct: 140 },
    { weeklyRemainingPct: -2 },
    { weeklyRemainingPct: null },
    { readAt: 'never' },
  ]
  for (const overrides of invalid) {
    assert.deepEqual(recordCycleReading(start, reading(overrides)), start, JSON.stringify(overrides))
  }
})

const NOW = new Date(2026, 10, 20, 12, 0, 0) // 2026-11-20 12:00 local

function cycleRec(resetDate, pct, readAt, serviceId = 'claude') {
  return { serviceId, resetDate, lastWeeklyRemainingPct: pct, readAt }
}

function runRec(id, cycleKey, estimatedCostPct, status = 'completed') {
  return { id, ideaId: `i-${id}`, serviceId: cycleKey.split(':')[0], cycleKey, estimatedCostPct, status }
}

test('summariseCycles reports history too short without any closed cycle', () => {
  const empty = summariseCycles({ cycles: [], runs: [], serviceId: 'claude', now: NOW })
  assert.deepEqual(empty, { serviceId: 'claude', status: 'history_too_short', cycles: [] })

  // Reset day 2026-11-25 has not started yet: cycle still open. Other service's closed cycle does not count.
  const open = summariseCycles({
    cycles: [cycleRec('2026-11-25', 30, local(2026, 11, 19)), cycleRec('2026-11-10', 30, local(2026, 11, 9), 'chatgpt')],
    runs: [],
    serviceId: 'claude',
    now: NOW,
  })
  assert.equal(open.status, 'history_too_short')
  assert.deepEqual(open.cycles, [])
})

test('summariseCycles treats the cycle as closed once the reset day has started', () => {
  const cycles = [cycleRec('2026-11-20', 30, local(2026, 11, 19, 18))]
  const atMidnight = summariseCycles({ cycles, runs: [], serviceId: 'claude', now: new Date(2026, 10, 20, 0, 0, 0) })
  assert.equal(atMidnight.status, 'ok')
  const before = summariseCycles({ cycles, runs: [], serviceId: 'claude', now: new Date(2026, 10, 19, 23, 59, 59) })
  assert.equal(before.status, 'history_too_short')
})

test('summariseCycles returns quota left, reading age at reset and consumption per closed cycle', () => {
  const cycles = deepFreeze([
    cycleRec('2026-11-10', 30, local(2026, 11, 9, 18)), // 6 h before reset day start
    cycleRec('2026-11-17', 55, local(2026, 11, 16, 0)), // 24 h before reset day start
  ])
  const runs = deepFreeze([
    runRec('a', 'claude:2026-11-10', 8),
    runRec('b', 'claude:2026-11-10', 3, 'failed'),
    runRec('c', 'claude:2026-11-17', 15),
    runRec('d', 'chatgpt:2026-11-10', 8),
    runRec('e', 'claude:2026-11-24', 8),
  ])
  const summary = summariseCycles({ cycles, runs, serviceId: 'claude', now: NOW })
  assert.equal(summary.status, 'ok')
  assert.equal(summary.serviceId, 'claude')
  assert.deepEqual(summary.cycles, [
    {
      cycleKey: 'claude:2026-11-17',
      serviceId: 'claude',
      resetDate: '2026-11-17',
      quotaLeftAtResetPct: 55,
      readingAgeHoursAtReset: 24,
      approximate: true,
      consumedByRunsPct: 15,
    },
    {
      cycleKey: 'claude:2026-11-10',
      serviceId: 'claude',
      resetDate: '2026-11-10',
      quotaLeftAtResetPct: 30,
      readingAgeHoursAtReset: 6,
      approximate: false,
      consumedByRunsPct: 11,
    },
  ])
})

test('summariseCycles marks approximate only when the age exceeds the freshness limit', () => {
  const cycles = [
    cycleRec('2026-11-10', 30, local(2026, 11, 9, 12)), // exactly 12 h
    cycleRec('2026-11-17', 30, local(2026, 11, 16, 11, 59)), // 12 h 1 min
  ]
  const byDate = (s) => Object.fromEntries(s.cycles.map((c) => [c.resetDate, c]))
  const dflt = byDate(summariseCycles({ cycles, runs: [], serviceId: 'claude', now: NOW }))
  assert.equal(dflt['2026-11-10'].approximate, false, 'age equal to the limit is not approximate')
  assert.equal(dflt['2026-11-17'].approximate, true)
  const strict = byDate(summariseCycles({ cycles, runs: [], serviceId: 'claude', now: NOW, freshnessHours: 6 }))
  assert.equal(strict['2026-11-10'].approximate, true)
  const lax = byDate(summariseCycles({ cycles, runs: [], serviceId: 'claude', now: NOW, freshnessHours: 48 }))
  assert.equal(lax['2026-11-17'].approximate, false)
})

test('summariseCycles gives zero consumption when no run carries the cycleKey', () => {
  const summary = summariseCycles({
    cycles: [cycleRec('2026-11-10', 30, local(2026, 11, 9, 18))],
    runs: [runRec('x', 'claude:2026-11-17', 8)],
    serviceId: 'claude',
    now: NOW,
  })
  assert.equal(summary.cycles[0].consumedByRunsPct, 0)
})
