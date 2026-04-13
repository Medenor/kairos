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
