// Decides which weekly-quota readings become reset-cycle readings (feature 006, T028, FR-032).
// Pure ES module: no clock, no storage. `now` is passed in by the caller (the hook edge).
import { recordCycleReading } from './cycles.js'
import { RESET_DATE_KEY, getConsumedPct, getResetInfo, quotaTimeKey } from '../utils.js'

const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Readings to record for the services whose weekly-quota stamp changed since `prevStamps`
 * ({serviceId: stamp}, null or {} on the first call, which treats every stamp as new).
 * A service gives a reading when it has a `surplus` block, a parseable stamp that is not in the
 * future, a numeric weekly value and a valid reset date (so a next reset date exists).
 * `readAt` is the stamp itself (when the value was entered or confirmed), not `now`.
 * Returns { readings: [{serviceId, nextResetDate, weeklyRemainingPct, readAt}], stamps } where
 * `stamps` is the map to pass as `prevStamps` next time.
 */
export function deriveCycleReadings(prevStamps, state, services, now) {
  const prev = prevStamps ?? {}
  const stamps = {}
  const readings = []
  for (const svc of Array.isArray(services) ? services : []) {
    const weeklyId = svc?.surplus?.weeklyQuotaId
    if (!weeklyId) continue
    const serviceState = state?.[svc.id]
    const stamp = serviceState?.[quotaTimeKey(weeklyId)]
    if (typeof stamp !== 'string' || stamp === '') continue
    stamps[svc.id] = stamp
    if (stamp === prev[svc.id]) continue

    const readMs = Date.parse(stamp)
    if (!Number.isFinite(readMs) || readMs > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) continue
    const quota = svc.quotas?.find((q) => q.id === weeklyId)
    const value = serviceState?.[weeklyId]
    if (!quota || !isNumber(value)) continue
    const { nextResetDate } = getResetInfo(serviceState?.[RESET_DATE_KEY] ?? null, svc.resetCycleDays, now)
    if (!nextResetDate) continue

    const weeklyRemainingPct = Math.min(100, Math.max(0, 100 - getConsumedPct(quota, value)))
    readings.push({
      serviceId: svc.id,
      ...(typeof svc.name === 'string' && svc.name !== '' ? { providerName: svc.name.slice(0, 60) } : {}),
      nextResetDate,
      weeklyRemainingPct,
      readAt: new Date(readMs).toISOString(),
    })
  }
  return { readings, stamps }
}

/**
 * Folds readings into `cycles` with recordCycleReading. Returns the same array (reference) when
 * nothing changed, so callers can skip persisting.
 */
export function applyCycleReadings(cycles, readings) {
  let next = cycles
  for (const reading of readings) {
    const updated = recordCycleReading(next, reading)
    if (updated === next) continue
    const before = next.find((c) => c.serviceId === reading.serviceId && c.resetDate === reading.nextResetDate)
    const after = updated.find((c) => c.serviceId === reading.serviceId && c.resetDate === reading.nextResetDate)
    if (before && before.readAt === after.readAt && before.lastWeeklyRemainingPct === after.lastWeeklyRemainingPct) continue
    next = updated
  }
  return next
}
