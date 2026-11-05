// Reset-cycle history for the surplus feature (pure ES module: no clock, no storage, no Node or browser APIs).
// `now` and every reading timestamp are passed in by the caller.
import { DEFAULTS } from './constants.js'
import { cycleKeyOf, validateCycleRecord } from './records.js'
import { resetDayStart } from './time.js'

const MS_PER_HOUR = 60 * 60 * 1000

/**
 * Keeps the last weekly quota reading taken before the reset day starts, per (serviceId, resetDate).
 * Returns a new array sorted by serviceId then resetDate, or the input unchanged when the reading is
 * invalid, taken on or after the reset day start, or older than the stored reading.
 */
export function recordCycleReading(cycles, { serviceId, providerName, nextResetDate, weeklyRemainingPct, readAt } = {}) {
  // `providerName` is the name at the time of the reading, so the record can still be named after a deletion.
  const candidate = { serviceId, resetDate: nextResetDate, lastWeeklyRemainingPct: weeklyRemainingPct, readAt, ...(providerName ? { providerName } : {}) }
  if (!validateCycleRecord(candidate).valid) return cycles

  const resetStart = resetDayStart(nextResetDate)
  const readMs = Date.parse(readAt)
  if (readMs >= resetStart.getTime()) return cycles

  const existing = cycles.find((c) => c.serviceId === serviceId && c.resetDate === nextResetDate)
  if (existing && readMs < Date.parse(existing.readAt)) return cycles

  const others = cycles.filter((c) => c !== existing)
  return [...others, candidate].sort(
    (a, b) => a.serviceId.localeCompare(b.serviceId) || a.resetDate.localeCompare(b.resetDate),
  )
}

/**
 * Summary of the closed reset cycles (reset day already started at `now`) of one service, most recent
 * reset first. Fewer than one closed cycle gives status 'history_too_short'.
 */
export function summariseCycles({ cycles, runs, serviceId, now, freshnessHours = DEFAULTS.FRESHNESS_HOURS }) {
  const runList = Array.isArray(runs) ? runs : []
  const closed = (Array.isArray(cycles) ? cycles : [])
    .filter((c) => c.serviceId === serviceId && validateCycleRecord(c).valid)
    .filter((c) => resetDayStart(c.resetDate).getTime() <= now.getTime())
    .sort((a, b) => b.resetDate.localeCompare(a.resetDate))

  if (closed.length === 0) return { serviceId, status: 'history_too_short', cycles: [] }

  const summaries = closed.map((c) => {
    const cycleKey = cycleKeyOf(c.serviceId, c.resetDate)
    const readingAgeHoursAtReset = (resetDayStart(c.resetDate).getTime() - Date.parse(c.readAt)) / MS_PER_HOUR
    const consumedByRunsPct = runList
      .filter((r) => r.cycleKey === cycleKey)
      .reduce((sum, r) => sum + r.estimatedCostPct, 0)
    return {
      cycleKey,
      serviceId: c.serviceId,
      resetDate: c.resetDate,
      quotaLeftAtResetPct: c.lastWeeklyRemainingPct,
      readingAgeHoursAtReset,
      approximate: readingAgeHoursAtReset > freshnessHours,
      consumedByRunsPct,
    }
  })

  return { serviceId, status: 'ok', cycles: summaries }
}
