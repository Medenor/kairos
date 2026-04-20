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

function parseISODateOnly(value) {
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
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

  const today = toUtcDateStart(now)
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
