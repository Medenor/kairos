// Test-only builders for routing tests: small runtime services with explicit fits and gating quotas,
// quota state, and reset dates expressed as "days left".
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const NOW = new Date(2026, 2, 4, 12, 0, 0) // local noon, 2026-03-04

export function quota(id, patch = {}) {
  return { id, label: `Quota ${id}`, type: 'consumed_pct', currency: null, lowBalance: null, gates: null, subnote: null, ...patch }
}

export function service(id, patch = {}) {
  return {
    id,
    name: id,
    color: null,
    cost: null,
    costCurrency: null,
    flags: [],
    note: '',
    resetType: 'weekly',
    resetCycleDays: 7,
    quotas: [quota(`${id}_q`)],
    fits: {},
    surplus: null,
    ...patch,
  }
}

// Last reset date such that the next reset is `daysLeft` days after `now` (negative = overdue).
export function lastResetFor(cycleDays, daysLeft, now = NOW) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (cycleDays - daysLeft))
  return localDate(d)
}

// state({ svcId: { q: 40, reset: 3 } }) with reset given as days left, for the service's cycle.
export function stateFor(services, values, now = NOW) {
  const state = {}
  for (const s of services) {
    const v = values[s.id] ?? {}
    state[s.id] = {}
    for (const q of s.quotas) if (q.id in v) state[s.id][q.id] = v[q.id]
    if (v.reset !== undefined && s.resetCycleDays) state[s.id].__last_reset_date = lastResetFor(s.resetCycleDays, v.reset, now)
    else state[s.id].__last_reset_date = null
  }
  return state
}

export function shuffle(list, seed) {
  const out = [...list]
  let s = seed
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
