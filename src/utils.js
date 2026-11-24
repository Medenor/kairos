import { resolveProviderName } from './providers/names.js'

// Default low-balance level of a currency quota (units of its own currency). It reproduces the
// former fixed bands: below 2 -> 85, below 5 -> 60, otherwise 20.
export const DEFAULT_LOW_BALANCE = 5

// Returns the "consumed" percentage for any quota type,
// normalised to 0–100 where 100 = fully exhausted.
export function getConsumedPct(quota, value) {
  switch (quota.type) {
    case 'consumed_pct':
      return value
    case 'remaining_pct':
      return 100 - value
    case 'currency': {
      const low = typeof quota.lowBalance === 'number' && quota.lowBalance > 0 ? quota.lowBalance : DEFAULT_LOW_BALANCE
      if (value <= 0) return 100
      if (value < 0.4 * low) return 85
      if (value < low) return 60
      return 20
    }
    default:
      return 0
  }
}

// Says what a reading means, in the unit the user entered it in, so a number is never shown without its
// direction ("18% left", "82% used") and a balance is never turned into an invented percentage.
// Returns { text, detail, consumedPct, balanceState }:
//   consumedPct   0-100 for percentage quotas (what a gauge draws), null for balances and unread quotas
//   balanceState  'exhausted' | 'low' | 'ok' for a currency quota, null otherwise
export function describeReading(quota, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { text: 'No reading yet', detail: '', consumedPct: null, balanceState: null }
  }
  const clamp = (n) => Math.min(100, Math.max(0, n))
  switch (quota.type) {
    case 'consumed_pct':
      return { text: `${value}% used`, detail: '', consumedPct: clamp(value), balanceState: null }
    case 'remaining_pct':
      return { text: `${value}% left`, detail: `${clamp(100 - value)}% used`, consumedPct: clamp(100 - value), balanceState: null }
    case 'currency': {
      const low = typeof quota.lowBalance === 'number' && quota.lowBalance > 0 ? quota.lowBalance : DEFAULT_LOW_BALANCE
      const balanceState = value <= 0 ? 'exhausted' : value < low ? 'low' : 'ok'
      const unit = quota.currency ? ` ${quota.currency}` : ''
      return { text: `${value.toFixed(2)}${unit}`, detail: '', consumedPct: null, balanceState }
    }
    default:
      return { text: String(value), detail: '', consumedPct: null, balanceState: null }
  }
}

// Returns the highest consumed % across the quotas of a service that have a reading.
// A quota with no stored value yet is unread: it is ignored, never turned into NaN.
export function getServicePressure(svc, state) {
  return svc.quotas.reduce((mx, q) => {
    const value = state?.[svc.id]?.[q.id]
    if (typeof value !== 'number' || !Number.isFinite(value)) return mx
    return Math.max(mx, getConsumedPct(q, value))
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
// v2 (feature 007): snapshots hold a `providers` map keyed by provider id. A v1 snapshot is read as a v2
// one with no `providers`; its `services` map is the legacy section, carried verbatim and shown read-only.
export const WEEKLY_HISTORY_SCHEMA_VERSION = 2
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

const isReading = (value) => typeof value === 'number' && Number.isFinite(value)

function providerEntry(provider, providerState) {
  const entry = {
    providerId: provider.id,
    name: provider.name,
    captured: {
      color: provider.color ?? null,
      note: provider.note ?? null,
      flags: Array.isArray(provider.flags) ? [...provider.flags] : [],
    },
    lastResetDate: providerState[RESET_DATE_KEY] ?? null,
    quotas: {},
  }
  for (const quota of provider.quotas || []) {
    const value = providerState[quota.id]
    // A quota with no reading yet is left out (never recorded as undefined or zero) until its first reading.
    if (!isReading(value)) continue
    entry.quotas[quota.id] = {
      quotaId: quota.id,
      label: quota.label,
      type: quota.type,
      value: cloneData(value),
      currency: quota.currency ?? null,
      consumedPct: getConsumedPct(quota, value),
      subnote: quota.subnote ?? null,
    }
  }
  return entry
}

/**
 * Builds the snapshot of the week containing `now` (schema v2).
 * - `providers`: runtime providers that are live; their entries are rebuilt from `state`.
 * - `removed`: tombstones ({ id, removedAt }); a previous entry of such a provider is kept and marked `removedAt`.
 * - `previous`: the existing snapshot of the same workspace and week, if any. Its entries of providers that
 *   are not in `providers` are kept as they are (removed or not yet known on this device), and its legacy
 *   `services` section is carried verbatim.
 */
export function createWeeklySnapshot({ workspaceId, state = {}, providers = [], removed = [], previous = null, now = new Date() }) {
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const weekInfo = getLocalWeekKey(now)
  const live = new Set(providers.map((provider) => provider.id))
  const entries = {}

  for (const [id, entry] of Object.entries(previous?.providers || {})) {
    if (live.has(id)) continue
    entries[id] = cloneData(entry)
  }
  for (const tombstone of removed) {
    const kept = entries[tombstone.id]
    if (kept && !kept.removedAt) kept.removedAt = tombstone.removedAt
  }
  for (const provider of providers) {
    entries[provider.id] = providerEntry(provider, state[provider.id] || {})
  }

  const snapshot = {
    schemaVersion: WEEKLY_HISTORY_SCHEMA_VERSION,
    workspaceId,
    weekKey: weekInfo.weekKey,
    weekStartDate: weekInfo.weekStartDate,
    weekEndDate: weekInfo.weekEndDate,
    capturedAt: new Date(now).toISOString(),
    providers: entries,
  }
  if (previous?.services) snapshot.services = cloneData(previous.services)
  return snapshot
}

// Merges two snapshots of the same workspace and week by union on provider id: an entry carrying
// `removedAt` wins over one without, otherwise the entry of the later `capturedAt` (a tie goes to
// `incoming`). The legacy `services` section is kept verbatim from whichever side has it. Used for any
// week both sides hold, so a stale or v1 remote snapshot never drops local entries (FR-028).
export function mergeWeekSnapshots(local, incoming) {
  if (!local) return cloneData(incoming)
  if (!incoming) return cloneData(local)
  const localTime = Date.parse(local.capturedAt) || 0
  const incomingTime = Date.parse(incoming.capturedAt) || 0
  const incomingNewer = incomingTime >= localTime
  const newer = incomingNewer ? incoming : local
  const older = incomingNewer ? local : incoming

  const providers = {}
  for (const id of new Set([...Object.keys(older.providers || {}), ...Object.keys(newer.providers || {})])) {
    const a = older.providers?.[id]
    const b = newer.providers?.[id]
    if (a && b) providers[id] = cloneData(a.removedAt && !b.removedAt ? a : b)
    else providers[id] = cloneData(a || b)
  }

  const merged = {
    ...cloneData(newer),
    schemaVersion: WEEKLY_HISTORY_SCHEMA_VERSION,
    providers,
  }
  const services = local.services ?? incoming.services
  if (services) merged.services = cloneData(services)
  else delete merged.services
  return merged
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
      // A week both sides hold is merged, never replaced.
      if (!inserted) {
        next.push(mergeWeekSnapshots(entry, snapshot))
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
// With no provider and nothing recorded for the week, nothing is recorded (FR-026).
export function recordWeeklySnapshot(history, { workspaceId, state, providers = [], removed = [], now = new Date(), completedWeeksToKeep = 52 }) {
  const weekKey = getLocalWeekKey(now).weekKey
  const existing = normalizeHistoryInput(history).find(
    (entry) => entry.workspaceId === workspaceId && entry.weekKey === weekKey
  )
  if (providers.length === 0 && !existing) return history
  const snapshot = createWeeklySnapshot({ workspaceId, state, providers, removed, previous: existing ?? null, now })
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

// Entry of a provider in a snapshot, from the v2 `providers` map or, for a former service id, from the
// legacy `services` section (read-only). Returns a uniform shape or null.
function entryFromSnapshot(snapshot, providerId) {
  const v2 = snapshot?.providers?.[providerId]
  if (v2) {
    return { name: v2.name ?? providerId, captured: v2.captured ?? null, lastResetDate: v2.lastResetDate ?? null, removedAt: v2.removedAt ?? null, quotas: v2.quotas ?? {}, legacy: false }
  }
  const v1 = snapshot?.services?.[providerId]
  if (v1) {
    return {
      name: v1.serviceName ?? v1.capturedServiceMeta?.serviceName ?? providerId,
      captured: v1.capturedServiceMeta ?? null,
      lastResetDate: v1.lastResetDate ?? null,
      removedAt: null,
      quotas: v1.quotas ?? {},
      legacy: true,
    }
  }
  return null
}

function orderedQuotaEntries(recorded, currentProvider) {
  const values = Object.values(recorded || {})
  if (!currentProvider) return values.map((quota) => cloneData(quota))
  const byId = new Map(values.map((quota) => [quota.quotaId, quota]))
  const ordered = []
  for (const quota of currentProvider.quotas || []) {
    if (byId.has(quota.id)) {
      ordered.push(cloneData(byId.get(quota.id)))
      byId.delete(quota.id)
    }
  }
  for (const quota of byId.values()) ordered.push(cloneData(quota))
  return ordered
}

/**
 * Series of one provider across weeks, by provider id. A rename continues one series under the current
 * name; weeks before the provider existed are `missing_service`, never zero; a removed provider keeps the
 * name it was recorded with and is flagged `removed`; a former service id (legacy section) is read-only.
 * `providers` are the live runtime providers; `catalogue` (optional) lets tombstones name removed ones.
 */
export function deriveProviderHistorySeries({ history, providerId, providers = [], catalogue = null, fromWeekKey, toWeekKey }) {
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

  const live = providers.find((provider) => provider.id === providerId) || null
  const tombstone = catalogue?.providers?.[providerId]?.status === 'removed' ? catalogue.providers[providerId] : null
  const startDate = weekStartFromWeekKey(startKey)
  const endDate = weekStartFromWeekKey(endKey)
  if (!startDate || !endDate) {
    return {
      providerId,
      displayName: live?.name ?? tombstone?.name ?? providerId,
      removed: !live,
      legacy: false,
      entries: [],
      hasEnoughHistoryForTrends: false,
      recordedWeekCount: 0,
    }
  }

  const entries = []
  let recordedWeekCount = 0
  let latestName = null
  let legacy = false
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

    const recorded = entryFromSnapshot(snapshot, providerId)
    if (!recorded) {
      entries.push({
        weekKey: weekInfo.weekKey,
        weekStartDate: weekInfo.weekStartDate,
        status: 'missing_service',
        quotas: [],
        message: 'No history recorded for this provider this week',
      })
      cursor = addLocalDays(cursor, 7)
      continue
    }

    recordedWeekCount += 1
    latestName = recorded.name
    legacy = legacy || recorded.legacy
    entries.push({
      weekKey: weekInfo.weekKey,
      weekStartDate: weekInfo.weekStartDate,
      status: 'recorded',
      quotas: orderedQuotaEntries(recorded.quotas, live),
      message: '',
      capturedName: recorded.name,
      removedAt: recorded.removedAt,
      lastResetDate: recorded.lastResetDate,
      capturedProviderMeta: {
        providerId,
        name: recorded.name,
        color: recorded.captured?.color ?? null,
        note: recorded.captured?.note ?? null,
        flags: Array.isArray(recorded.captured?.flags) ? [...recorded.captured.flags] : [],
      },
    })

    cursor = addLocalDays(cursor, 7)
  }

  return {
    providerId,
    displayName: live?.name ?? latestName ?? tombstone?.name ?? resolveProviderName(providerId, { catalogue }).name,
    removed: !live,
    legacy,
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
// Pure function — no side effects. Pass the same `now` as the recommendation and the surplus
// evaluation so every day count uses one local-day basis (FR-038).
export function getResetSignals(state, services, now = new Date()) {
  const signals = {}
  for (const svc of services) {
    signals[svc.id] = getResetInfo(
      state[svc.id]?.[RESET_DATE_KEY] ?? null,
      svc.resetCycleDays,
      now
    )
  }
  return signals
}
