// Pure state transitions shared by useQuotaState and useSharedQuotaState.
// Keeping them outside the hooks lets scenario tests exercise load, update, reset
// and server-sync behavior in plain Node without a DOM renderer.
export { applyProviderStateEffects } from './providers/stateEffects.js'
import {
  RESET_DATE_KEY,
  quotaTimeKey,
  recordWeeklySnapshot,
  retainWeeklySnapshots,
  upsertCurrentWeekSnapshot,
} from './utils.js'

export const LOCAL_WORKSPACE_ID = 'local'

// Nothing is pre-filled: with no provider the state is `{}`. A provider's quotas start unread
// (`null` value and stamp) until a reading is entered. Entries of ids no provider defines (data written
// by the previous fixed-provider build) are never read here and are preserved by every transition.
export function buildDefaultState(providers = []) {
  const state = {}
  providers.forEach((provider) => {
    state[provider.id] = {}
    provider.quotas.forEach((quota) => {
      state[provider.id][quota.id] = null
      state[provider.id][quotaTimeKey(quota.id)] = null
    })
    state[provider.id][RESET_DATE_KEY] = null
  })
  return state
}

function setQuotaValue(prev, serviceId, key, value) {
  return {
    ...prev,
    [serviceId]: {
      ...(prev[serviceId] || {}),
      [key]: value,
    },
  }
}

// `now` is required: pure transitions never read the clock. Metadata keys
// (`__last_reset_date`, `__ts_*`) are stored as-is and never get a stamp of their own.
export function applyQuotaUpdate(prev, serviceId, quotaId, value, now) {
  const next = setQuotaValue(prev, serviceId, quotaId, value)
  if (String(quotaId).startsWith('__')) return next
  return setQuotaValue(next, serviceId, quotaTimeKey(quotaId), now.toISOString())
}

// Stamps every quota of a service that has a reading as "still current" without changing any value.
// A quota that was never read stays unread: confirming nothing must not make it look freshly read.
export function confirmQuotas(prev, serviceId, now, services = []) {
  const service = services.find((item) => item.id === serviceId)
  if (!service) return prev
  const stamp = now.toISOString()
  const serviceState = { ...(prev[serviceId] || {}) }
  service.quotas.forEach((quota) => {
    const value = serviceState[quota.id]
    if (typeof value === 'number' && Number.isFinite(value)) serviceState[quotaTimeKey(quota.id)] = stamp
  })
  return { ...prev, [serviceId]: serviceState }
}

function logicalKeyToQuota(logicalKey) {
  const [serviceId, ...rest] = String(logicalKey).split(':')
  return { serviceId, quotaId: rest.join(':') }
}

// Applies a `quota_state` record to live state. Any other record type is ignored,
// so shared weekly snapshots can never alter current quota values.
export function applyQuotaRecord(prev, record) {
  if (record?.record_type !== 'quota_state') return prev
  const { serviceId, quotaId } = logicalKeyToQuota(record.logical_key)
  if (!serviceId || !quotaId) return prev
  const value = record?.payload?.value
  if (value === undefined) return prev
  return setQuotaValue(prev, serviceId, quotaId, value)
}

// Merges a shared `snapshot` record into local weekly history. The record's own
// workspace wins over the payload so history stays scoped to the workspace it
// was stored in, even if the payload was authored under another id.
export function applySnapshotRecord(history, record, { now = new Date() } = {}) {
  if (record?.record_type !== 'snapshot' || !record?.payload) return history
  const workspaceId = record.workspace_id || record.payload.workspaceId
  const payload = workspaceId ? { ...record.payload, workspaceId } : record.payload
  return retainWeeklySnapshots(upsertCurrentWeekSnapshot(history, payload), { now })
}

// Folds a batch of server records into { state, recordIndex, weeklyHistory, historyIndex }.
export function applyServerRecords(base, items = [], { now = new Date() } = {}) {
  let state = base.state
  let weeklyHistory = base.weeklyHistory
  const recordIndex = { ...base.recordIndex }
  const historyIndex = { ...base.historyIndex }

  for (const item of items) {
    if (item.record_type === 'quota_state') {
      state = applyQuotaRecord(state, item)
      recordIndex[item.logical_key] = item
    } else if (item.record_type === 'snapshot') {
      weeklyHistory = applySnapshotRecord(weeklyHistory, item, { now })
      historyIndex[item.logical_key] = item
    }
  }

  return { state, recordIndex, weeklyHistory, historyIndex }
}

// Records the current-week snapshot for the given state. Returns the same history reference when nothing
// changed (including when there is no provider and nothing recorded yet, FR-026). `removed` lists the
// tombstones ({ id, removedAt }) so entries of deleted providers are kept and marked.
export function recordCurrentWeek(history, { workspaceId, state, providers = [], removed = [], now = new Date() }) {
  return recordWeeklySnapshot(history, {
    workspaceId: workspaceId || LOCAL_WORKSPACE_ID,
    state,
    providers,
    removed,
    now,
  })
}

// History visible for a workspace: only that workspace's snapshots.
export function scopeHistory(history, workspaceId) {
  const scope = workspaceId || LOCAL_WORKSPACE_ID
  return (history || []).filter((item) => item.workspaceId === scope)
}
