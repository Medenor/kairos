import { SERVICES } from '../data/services.js'
import {
  RESET_DATE_KEY,
  WEEKLY_HISTORY_LOGICAL_KEY_PREFIX,
  WEEKLY_HISTORY_STORAGE_KEY,
  loadWeeklyHistory,
} from '../utils.js'
import { LOCAL_WORKSPACE_ID } from '../stateTransitions.js'

const STORAGE_KEY = 'kairos-ai-quota-router:state'

// Builds `snapshot` records for the target workspace. Only snapshots recorded
// locally (workspace 'local') or already owned by the target are exported, and each
// payload is re-scoped to the target so it appears in that workspace's history.
// One record per week: the most recently captured snapshot wins.
export function buildWeeklyHistoryMigrationRecords(history, workspaceId) {
  if (!workspaceId) return []
  const byWeek = new Map()
  for (const snapshot of history || []) {
    if (!snapshot?.weekKey || !snapshot?.workspaceId) continue
    if (snapshot.workspaceId !== LOCAL_WORKSPACE_ID && snapshot.workspaceId !== workspaceId) continue
    const current = byWeek.get(snapshot.weekKey)
    if (!current || String(snapshot.capturedAt ?? '') > String(current.capturedAt ?? '')) {
      byWeek.set(snapshot.weekKey, snapshot)
    }
  }

  return Array.from(byWeek.values()).map((snapshot) => {
    const payload = { ...snapshot, workspaceId }
    return {
      logical_key: `${WEEKLY_HISTORY_LOGICAL_KEY_PREFIX}${snapshot.weekKey}`,
      record_type: 'snapshot',
      payload,
      source_fingerprint: `weekly-history:${workspaceId}:${snapshot.weekKey}:${snapshot.capturedAt ?? 'unknown'}`,
    }
  })
}

export function exportLocalStateForMigration(workspaceId) {
  const raw = localStorage.getItem(STORAGE_KEY)
  let parsed = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  const records = []
  for (const svc of SERVICES) {
    const svcState = parsed[svc.id] || {}
    for (const quota of svc.quotas) {
      const value = svcState[quota.id] ?? quota.value
      records.push({
        logical_key: `${svc.id}:${quota.id}`,
        record_type: 'quota_state',
        payload: { value },
        source_fingerprint: `${svc.id}:${quota.id}:${value}`,
      })
    }
    const lastResetDate = svcState[RESET_DATE_KEY] ?? null
    records.push({
      logical_key: `${svc.id}:${RESET_DATE_KEY}`,
      record_type: 'quota_state',
      payload: { value: lastResetDate },
      source_fingerprint: `${svc.id}:${RESET_DATE_KEY}:${lastResetDate ?? 'null'}`,
    })
  }

  records.push(
    ...buildWeeklyHistoryMigrationRecords(
      loadWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_STORAGE_KEY)),
      workspaceId
    )
  )

  return {
    source_device_id: `${navigator.platform || 'browser'}-${navigator.language || 'en'}`,
    exported_at: new Date().toISOString(),
    records,
  }
}
