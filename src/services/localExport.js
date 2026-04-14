import { SERVICES } from '../data/services'

const STORAGE_KEY = 'kairos-ai-quota-router:state'

export function exportLocalStateForMigration() {
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
  }

  return {
    source_device_id: `${navigator.platform || 'browser'}-${navigator.language || 'en'}`,
    exported_at: new Date().toISOString(),
    records,
  }
}
