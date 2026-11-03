// Pure state transitions shared by useQuotaState and useSharedQuotaState.
// Keeping them outside the hooks lets scenario tests exercise load, update, reset
// and server-sync behavior in plain Node without a DOM renderer.
import { SERVICES } from './data/services.js'
import {
  RESET_DATE_KEY,
  recordWeeklySnapshot,
  retainWeeklySnapshots,
  upsertCurrentWeekSnapshot,
} from './utils.js'

export const LOCAL_WORKSPACE_ID = 'local'

export function buildDefaultState(services = SERVICES) {
  const state = {}
  services.forEach((service) => {
    state[service.id] = {}
    service.quotas.forEach((quota) => {
      state[service.id][quota.id] = quota.value
    })
    state[service.id][RESET_DATE_KEY] = null
  })
  return state
}

export function applyQuotaUpdate(prev, serviceId, quotaId, value) {
  return {
    ...prev,
    [serviceId]: {
      ...(prev[serviceId] || {}),
      [quotaId]: value,
    },
  }
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
  return applyQuotaUpdate(prev, serviceId, quotaId, value)
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

// Records the current-week snapshot for the given state. Returns the same history
// reference when nothing changed.
export function recordCurrentWeek(history, { workspaceId, state, services = SERVICES, now = new Date() }) {
  return recordWeeklySnapshot(history, {
    workspaceId: workspaceId || LOCAL_WORKSPACE_ID,
    state,
    services,
    now,
  })
}

// History visible for a workspace: only that workspace's snapshots.
export function scopeHistory(history, workspaceId) {
  const scope = workspaceId || LOCAL_WORKSPACE_ID
  return (history || []).filter((item) => item.workspaceId === scope)
}
