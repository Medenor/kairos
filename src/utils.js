// Returns the "consumed" percentage for any quota type,
// normalised to 0–100 where 100 = fully exhausted.
export function getConsumedPct(quota, value) {
  switch (quota.type) {
    case 'consumed_pct':
      return value
    case 'remaining_pct':
      return 100 - value
    case 'currency':
      if (value <= 0) return 100
      if (value < 2) return 85
      if (value < 5) return 60
      return 20
    default:
      return 0
  }
}

// Returns the highest consumed % across all quotas for a service.
export function getServicePressure(svc, state) {
  return svc.quotas.reduce((mx, q) => {
    return Math.max(mx, getConsumedPct(q, state[svc.id][q.id] ?? q.value))
  }, 0)
}

export function getStatusBadge(pct) {
  if (pct < 50) return { label: 'Available', level: 'ok' }
  if (pct < 80) return { label: 'Watch out', level: 'warn' }
  if (pct < 100) return { label: 'Critical', level: 'crit' }
  return { label: 'Exhausted', level: 'off' }
}

export function getBarColor(consumedPct) {
  if (consumedPct < 50) return '#1D9E75'
  if (consumedPct < 80) return '#EF9F27'
  return '#E24B4A'
}

export const RESET_DATE_KEY = '__last_reset_date'
export const QUOTA_TS_PREFIX = '__ts_'
export const quotaTimeKey = (quotaId) => `${QUOTA_TS_PREFIX}${quotaId}`
export const WEEKLY_HISTORY_STORAGE_KEY = 'kairos:weekly-history'
export const WEEKLY_HISTORY_SCHEMA_VERSION = 1
export const WEEKLY_HISTORY_LOGICAL_KEY_PREFIX = 'weekly-history:'

function cloneData(value) {
  if (value === null || value === undefined) return value
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toLocalMidday(date) {
  const out = new Date(date)
  out.setHours(12, 0, 0, 0)
  return out
}

function startOfLocalDay(date) {
  const out = toLocalMidday(date)
  out.setHours(0, 0, 0, 0)
  return out
}

function addLocalDays(date, days) {
  const out = toLocalMidday(date)
  out.setDate(out.getDate() + days)
  return out
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function weekStartFromDate(date) {
  const local = startOfLocalDay(date)
  const day = local.getDay() || 7
  return addLocalDays(local, 1 - day)
}

function weekStartFromWeekKey(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(weekKey))
  if (!match) return null
  const weekYear = Number(match[1])
  const weekNumber = Number(match[2])
  const jan4 = toLocalMidday(new Date(weekYear, 0, 4))
  const jan4Day = jan4.getDay() || 7
  const firstWeekStart = addLocalDays(jan4, 1 - jan4Day)
  return addLocalDays(firstWeekStart, (weekNumber - 1) * 7)
}

function compareWeekKeysAsc(left, right) {
  const leftStart = weekStartFromWeekKey(left)?.getTime() ?? Number.NEGATIVE_INFINITY
  const rightStart = weekStartFromWeekKey(right)?.getTime() ?? Number.NEGATIVE_INFINITY
  return leftStart - rightStart
}

function compareWeekKeysDesc(left, right) {
  return compareWeekKeysAsc(right, left)
}

function normalizeHistoryInput(history) {
  if (!Array.isArray(history)) return []
  return history.filter(Boolean)
}

export function getLocalWeekKey(date = new Date()) {
  const weekStart = weekStartFromDate(date)
  const local = startOfLocalDay(date)
  const day = local.getDay() || 7
  const weekThursday = addLocalDays(local, 4 - day)
  const weekYear = weekThursday.getFullYear()
  const yearStart = toLocalMidday(new Date(weekYear, 0, 1))
  const yearStartDay = yearStart.getDay() || 7
  const firstThursday = addLocalDays(yearStart, 4 - yearStartDay)
  const weekNumber = Math.round((startOfLocalDay(weekThursday).getTime() - startOfLocalDay(firstThursday).getTime()) / 604800000) + 1

  return {
    weekKey: `${weekYear}-W${pad2(weekNumber)}`,
    weekStartDate: formatLocalDate(weekStart),
    weekEndDate: formatLocalDate(addLocalDays(weekStart, 6)),
  }
}

export function createWeeklySnapshot({ workspaceId, state = {}, services = [], now = new Date() }) {
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const weekInfo = getLocalWeekKey(now)
  const servicesSnapshot = {}

  for (const service of services) {
    const serviceState = state[service.id] || {}
    const serviceSnapshot = {
      serviceId: service.id,
      serviceName: service.name,
      capturedServiceMeta: {
        serviceId: service.id,
        serviceName: service.name,
        color: service.color ?? null,
        note: service.note ?? null,
        flags: Array.isArray(service.flags) ? [...service.flags] : [],
      },
      lastResetDate: serviceState[RESET_DATE_KEY] ?? null,
      quotas: {},
    }

    for (const quota of service.quotas || []) {
      const rawValue = serviceState[quota.id] ?? quota.value
      const value = cloneData(rawValue)
      serviceSnapshot.quotas[quota.id] = {
        quotaId: quota.id,
        label: quota.label,
        type: quota.type,
        value,
        currency: quota.currency ?? null,
        consumedPct: getConsumedPct(quota, value),
        subnote: quota.subnote ?? null,
      }
    }

    servicesSnapshot[service.id] = serviceSnapshot
  }

  return {
    schemaVersion: WEEKLY_HISTORY_SCHEMA_VERSION,
    workspaceId,
    weekKey: weekInfo.weekKey,
    weekStartDate: weekInfo.weekStartDate,
    weekEndDate: weekInfo.weekEndDate,
    capturedAt: new Date(now).toISOString(),
    services: servicesSnapshot,
  }
}

// Two snapshots are equivalent when everything but the capture timestamp matches.
// Used to skip no-op rewrites so `capturedAt` only moves when content changes.
export function snapshotsEquivalent(left, right) {
  if (!left || !right) return false
  const { capturedAt: _leftCapturedAt, ...leftRest } = left
  const { capturedAt: _rightCapturedAt, ...rightRest } = right
  return JSON.stringify(leftRest) === JSON.stringify(rightRest)
}

export function upsertCurrentWeekSnapshot(history, snapshot) {
  const next = []
  let inserted = false
  const sourceHistory = normalizeHistoryInput(history)

  for (const entry of sourceHistory) {
    if (
      entry.workspaceId === snapshot.workspaceId &&
      entry.weekKey === snapshot.weekKey
    ) {
      if (!inserted) {
        next.push(cloneData(snapshot))
        inserted = true
      }
      continue
    }
    next.push(cloneData(entry))
  }

  if (!inserted) {
    next.push(cloneData(snapshot))
  }

  return next
}

export function retainWeeklySnapshots(history, { now = new Date(), completedWeeksToKeep = 52 } = {}) {
  const sourceHistory = normalizeHistoryInput(history)
  const currentWeekKey = getLocalWeekKey(now).weekKey
  const grouped = new Map()

  for (const entry of sourceHistory) {
    if (!entry || !entry.workspaceId || !entry.weekKey) continue
    const workspaceEntries = grouped.get(entry.workspaceId) || new Map()
    workspaceEntries.set(entry.weekKey, cloneData(entry))
    grouped.set(entry.workspaceId, workspaceEntries)
  }

  const retained = []
  for (const [, workspaceEntries] of grouped) {
    const entries = Array.from(workspaceEntries.values())
    const currentWeekEntry = entries.find((entry) => entry.weekKey === currentWeekKey)
    if (currentWeekEntry) {
      retained.push(currentWeekEntry)
    }

    const completedEntries = entries
      .filter((entry) => entry.weekKey !== currentWeekKey)
      .sort((left, right) => compareWeekKeysDesc(left.weekKey, right.weekKey))

    retained.push(...completedEntries.slice(0, completedWeeksToKeep))
  }

  return retained.sort((left, right) => {
    const workspaceCompare = String(left.workspaceId).localeCompare(String(right.workspaceId))
    if (workspaceCompare !== 0) return workspaceCompare
    return compareWeekKeysAsc(left.weekKey, right.weekKey)
  })
}

export function loadWeeklyHistory(rawValue) {
  if (!rawValue) return []
  if (Array.isArray(rawValue)) return normalizeHistoryInput(rawValue).map((entry) => cloneData(entry))

  try {
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed.map((entry) => cloneData(entry)) : []
  } catch {
    return []
  }
}

// Records the current-week snapshot. When the stored snapshot for the same
// workspace and week already matches, the original history reference is returned
// so callers (React state) see no change and `capturedAt` is preserved.
export function recordWeeklySnapshot(history, { workspaceId, state, services, now = new Date(), completedWeeksToKeep = 52 }) {
  const snapshot = createWeeklySnapshot({ workspaceId, state, services, now })
  const existing = normalizeHistoryInput(history).find(
    (entry) => entry.workspaceId === snapshot.workspaceId && entry.weekKey === snapshot.weekKey
  )
  if (existing && snapshotsEquivalent(existing, snapshot)) {
    return history
  }
  const withSnapshot = upsertCurrentWeekSnapshot(history, snapshot)
  return retainWeeklySnapshots(withSnapshot, { now, completedWeeksToKeep })
}

// Moves snapshots recorded before a workspace was known (scoped to `fromWorkspaceId`,
// 'local' by default) into the resolved workspace. An existing snapshot for the same
// workspace and week always wins, so a workspace's own history is never overwritten.
export function adoptLocalSnapshots(history, workspaceId, { fromWorkspaceId = 'local', now = new Date() } = {}) {
  const source = normalizeHistoryInput(history)
  if (!workspaceId || workspaceId === fromWorkspaceId) return source.map((entry) => cloneData(entry))

  const owned = new Set(
    source.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.weekKey)
  )
  const next = []
  for (const entry of source) {
    if (entry.workspaceId !== fromWorkspaceId) {
      next.push(cloneData(entry))
      continue
    }
    if (owned.has(entry.weekKey)) continue
    next.push({ ...cloneData(entry), workspaceId })
  }
  return retainWeeklySnapshots(next, { now })
}

function getServiceMetaFromSnapshot(snapshotService, currentService) {
  if (snapshotService?.capturedServiceMeta) {
    return snapshotService.capturedServiceMeta
  }
  if (currentService) {
    return {
      serviceId: currentService.id,
      serviceName: currentService.name,
      color: currentService.color ?? null,
      note: currentService.note ?? null,
      flags: Array.isArray(currentService.flags) ? [...currentService.flags] : [],
    }
  }
  return {
    serviceId: snapshotService?.serviceId ?? null,
    serviceName: snapshotService?.serviceName ?? snapshotService?.serviceId ?? null,
    color: null,
    note: null,
    flags: [],
  }
}

function getQuotaEntries(snapshotService, currentService) {
  const recordedQuotas = snapshotService?.quotas ? Object.values(snapshotService.quotas) : []
  if (!currentService) return recordedQuotas.map((quota) => cloneData(quota))

  const ordered = []
  const recordedById = new Map(recordedQuotas.map((quota) => [quota.quotaId, quota]))

  for (const quota of currentService.quotas || []) {
    const recorded = recordedById.get(quota.id)
    if (recorded) {
      ordered.push(cloneData(recorded))
      recordedById.delete(quota.id)
    }
  }

  for (const quota of recordedById.values()) {
    ordered.push(cloneData(quota))
  }

  return ordered
}

export function deriveServiceHistorySeries({ history, serviceId, services = [], fromWeekKey, toWeekKey }) {
  const sourceHistory = normalizeHistoryInput(history)
  const orderedHistory = new Map()
  for (const entry of sourceHistory) {
    if (!entry?.weekKey) continue
    orderedHistory.set(entry.weekKey, entry)
  }

  let startKey = fromWeekKey
  let endKey = toWeekKey
  if (!startKey || !endKey) {
    const keys = Array.from(orderedHistory.keys()).sort(compareWeekKeysAsc)
    startKey = startKey || keys[0]
    endKey = endKey || keys[keys.length - 1]
  }

  const startDate = weekStartFromWeekKey(startKey)
  const endDate = weekStartFromWeekKey(endKey)
  if (!startDate || !endDate) {
    return {
      serviceId,
      displayName: serviceId,
      entries: [],
      hasEnoughHistoryForTrends: false,
      recordedWeekCount: 0,
    }
  }

  const currentService = services.find((service) => service.id === serviceId) || null
  const discoveredService = sourceHistory.find((entry) => entry?.services?.[serviceId])?.services?.[serviceId] || null
  const displayName = currentService?.name || discoveredService?.serviceName || discoveredService?.capturedServiceMeta?.serviceName || serviceId

  const entries = []
  let recordedWeekCount = 0
  let cursor = toLocalMidday(startDate)
  const finalDate = toLocalMidday(endDate)

  while (cursor.getTime() <= finalDate.getTime()) {
    const weekInfo = getLocalWeekKey(cursor)
    const snapshot = orderedHistory.get(weekInfo.weekKey)

    if (!snapshot) {
      entries.push({
        weekKey: weekInfo.weekKey,
        weekStartDate: weekInfo.weekStartDate,
        status: 'missing_week',
        quotas: [],
        message: 'No snapshot recorded for this week.',
      })
      cursor = addLocalDays(cursor, 7)
      continue
    }

    const snapshotService = snapshot.services?.[serviceId]
    if (!snapshotService) {
      entries.push({
        weekKey: weekInfo.weekKey,
        weekStartDate: weekInfo.weekStartDate,
        status: 'missing_service',
        quotas: [],
        message: 'This service was not present in the recorded snapshot for this week.',
      })
      cursor = addLocalDays(cursor, 7)
      continue
    }

    recordedWeekCount += 1
    entries.push({
      weekKey: weekInfo.weekKey,
      weekStartDate: weekInfo.weekStartDate,
      status: 'recorded',
      quotas: getQuotaEntries(snapshotService, currentService),
      message: '',
      capturedServiceMeta: getServiceMetaFromSnapshot(snapshotService, currentService),
    })

    cursor = addLocalDays(cursor, 7)
  }

  return {
    serviceId,
    displayName,
    entries,
    hasEnoughHistoryForTrends: recordedWeekCount >= 2,
    recordedWeekCount,
  }
}

function parseISODateOnly(value) {
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  // V8 rolls impossible days of a short month over (2026-02-31 becomes 2026-03-03): reject them.
  if (date.toISOString().slice(0, 10) !== value) return null
  return date
}

function toUtcDateStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date, days) {
  const out = new Date(date)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

function dayDiff(a, b) {
  const ms = toUtcDateStart(a).getTime() - toUtcDateStart(b).getTime()
  return Math.round(ms / 86400000)
}

export function getResetInfo(lastResetDate, resetCycleDays, now = new Date()) {
  if (!resetCycleDays || resetCycleDays <= 0) {
    return {
      state: 'none',
      label: 'No scheduled reset',
      daysRemaining: null,
      nextResetDate: null,
    }
  }

  if (!lastResetDate) {
    return {
      state: 'unset',
      label: 'Last reset date not set',
      daysRemaining: null,
      nextResetDate: null,
    }
  }

  const parsedReset = parseISODateOnly(lastResetDate)
  if (!parsedReset) {
    return {
      state: 'invalid',
      label: 'Invalid reset date',
      daysRemaining: null,
      nextResetDate: null,
    }
  }

  // "Today" is the local calendar day of `now`, expressed as a UTC-midnight
  // date so the UTC-based day arithmetic below stays unchanged (006 research D3).
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  if (parsedReset.getTime() > today.getTime()) {
    return {
      state: 'invalid',
      label: 'Reset date cannot be in the future',
      daysRemaining: null,
      nextResetDate: null,
    }
  }

  const nextReset = addDays(parsedReset, resetCycleDays)
  const remaining = dayDiff(nextReset, today)
  if (remaining > 0) {
    return {
      state: 'countdown',
      label: `${remaining}d until next reset`,
      daysRemaining: remaining,
      nextResetDate: nextReset.toISOString().slice(0, 10),
    }
  }
  if (remaining === 0) {
    return {
      state: 'due',
      label: 'Reset due today',
      daysRemaining: 0,
      nextResetDate: nextReset.toISOString().slice(0, 10),
    }
  }

  return {
    state: 'overdue',
    label: `Overdue by ${Math.abs(remaining)}d`,
    daysRemaining: remaining,
    nextResetDate: nextReset.toISOString().slice(0, 10),
  }
}

// Returns a map of reset timing signals for all services.
// Pure function — no side effects.
export function getResetSignals(state, services) {
  const signals = {}
  for (const svc of services) {
    signals[svc.id] = getResetInfo(
      state[svc.id]?.[RESET_DATE_KEY] ?? null,
      svc.resetCycleDays
    )
  }
  return signals
}
