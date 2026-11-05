import { activeProviders } from '../providers/runtime.js'
import { ORDER_KEY, providerKey } from '../providers/records.js'
import { loadCatalogue } from '../providers/storage.js'
import {
  RESET_DATE_KEY,
  quotaTimeKey,
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

const isReading = (value) => typeof value === 'number' && Number.isFinite(value)

// Quota-state records of the declared providers: the reading (only when one exists), its stamp and the
// reset date. Entries of ids no provider defines (data of the previous fixed-provider build) are
// not exported (FR-020).
export function buildQuotaMigrationRecords(providers, state) {
  const records = []
  for (const provider of providers) {
    const providerState = state?.[provider.id] || {}
    for (const quota of provider.quotas) {
      const value = providerState[quota.id]
      if (isReading(value)) {
        records.push({
          logical_key: `${provider.id}:${quota.id}`,
          record_type: 'quota_state',
          payload: { value },
          source_fingerprint: `${provider.id}:${quota.id}:${value}`,
        })
      }
      const stampKey = quotaTimeKey(quota.id)
      const stamp = providerState[stampKey] ?? null
      records.push({
        logical_key: `${provider.id}:${stampKey}`,
        record_type: 'quota_state',
        payload: { value: stamp },
        source_fingerprint: `${provider.id}:${stampKey}:${stamp ?? 'null'}`,
      })
    }
    const lastResetDate = providerState[RESET_DATE_KEY] ?? null
    records.push({
      logical_key: `${provider.id}:${RESET_DATE_KEY}`,
      record_type: 'quota_state',
      payload: { value: lastResetDate },
      source_fingerprint: `${provider.id}:${RESET_DATE_KEY}:${lastResetDate ?? 'null'}`,
    })
  }
  return records
}

// Definition records of the catalogue: every provider (active ones and tombstones, so a deletion
// travels too) and the display order, as `routing_config` records like in shared mode. Surplus
// records are not part of the export (scope unchanged).
export function buildProviderMigrationRecords(catalogue) {
  const records = Object.values(catalogue.providers).map((payload) => ({
    logical_key: providerKey(payload.id),
    record_type: 'routing_config',
    payload,
    source_fingerprint: `provider:${payload.id}:${payload.status}:${payload.updatedAt ?? payload.removedAt}`,
  }))
  if (catalogue.order.length > 0) {
    records.push({
      logical_key: ORDER_KEY,
      record_type: 'routing_config',
      payload: { schemaVersion: 1, ids: catalogue.order, updatedAt: catalogue.orderUpdatedAt ?? new Date(0).toISOString() },
      source_fingerprint: `${ORDER_KEY}:${catalogue.order.join(',')}`,
    })
  }
  return records
}

export function exportLocalStateForMigration(workspaceId) {
  const raw = localStorage.getItem(STORAGE_KEY)
  let parsed = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  const catalogue = loadCatalogue(localStorage)
  const records = [...buildProviderMigrationRecords(catalogue), ...buildQuotaMigrationRecords(activeProviders(catalogue), parsed)]

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
