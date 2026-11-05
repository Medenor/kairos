// Form draft <-> reducer input. Pure and rule-free: it only converts what the user typed into the
// shape `addProvider`/`updateProvider` validate. Every rule (limits, uniqueness, ranges) lives in
// src/providers/schema.js; the form just shows the errors those return.
import { TASKS } from '../data/tasks.js'

let refCounter = 0
export const newQuotaRef = () => `ref${(refCounter += 1)}`

export function emptyQuotaDraft(patch = {}) {
  return { ref: newQuotaRef(), id: null, label: '', type: 'consumed_pct', currency: '', lowBalance: '', gates: null, subnote: '', value: '', ...patch }
}

export function emptyDraft() {
  return {
    name: '',
    costAmount: '',
    costCurrency: '€',
    color: '',
    flags: '',
    note: '',
    scheduleType: 'weekly',
    cycleDays: '',
    quotas: [emptyQuotaDraft()],
    fits: {},
    surplus: { tool: '', weeklyRef: '', sessionRef: '' },
  }
}

// Number('') is 0, which would silently accept an empty field: keep empty as "not entered".
const toNumber = (text) => (String(text).trim() === '' ? undefined : Number(text))

// An existing quota whose value text and type are untouched sends no value: editing a name must not
// restamp a reading. A changed type always sends the value (it has to be re-entered or confirmed, FR-007).
function valueToSend(q) {
  const existing = Boolean(q.id) && q.originalValue !== undefined
  if (existing && q.value === q.originalValue && q.type === q.originalType) return undefined
  return toNumber(q.value)
}

export function draftToInput(draft) {
  const amount = toNumber(draft.costAmount)
  const fits = {}
  for (const task of TASKS) if (draft.fits[task.id]) fits[task.id] = draft.fits[task.id]
  return {
    name: draft.name,
    cost: amount === undefined ? null : { amount, currency: draft.costCurrency },
    color: draft.color.trim() === '' ? null : draft.color.trim(),
    flags: draft.flags.split(',').map((f) => f.trim()).filter(Boolean),
    note: draft.note,
    schedule: draft.scheduleType === 'custom' ? { type: 'custom', cycleDays: toNumber(draft.cycleDays) } : { type: draft.scheduleType },
    quotas: draft.quotas.map((q) => ({
      ref: q.ref,
      ...(q.id ? { id: q.id } : {}),
      label: q.label,
      type: q.type,
      currency: q.type === 'currency' ? q.currency : null,
      lowBalance: q.type === 'currency' ? (toNumber(q.lowBalance) ?? null) : null,
      gates: q.gates && q.gates.length ? q.gates : null,
      subnote: q.subnote.trim() === '' ? null : q.subnote,
      value: valueToSend(q),
    })),
    fits,
    surplus: draft.surplus.tool
      ? { tool: draft.surplus.tool, weeklyQuotaId: draft.surplus.weeklyRef || null, sessionQuotaId: draft.surplus.sessionRef || null }
      : null,
  }
}

export function draftFromProvider(provider, state = {}) {
  const current = state[provider.id] ?? {}
  const refOf = (quotaId) => (provider.quotas.some((q) => q.id === quotaId) ? quotaId : '')
  return {
    name: provider.name,
    costAmount: provider.cost ? String(provider.cost.amount) : '',
    costCurrency: provider.cost ? provider.cost.currency : '€',
    color: provider.color ?? '',
    flags: (provider.flags ?? []).join(', '),
    note: provider.note ?? '',
    scheduleType: provider.schedule.type,
    cycleDays: provider.schedule.type === 'custom' ? String(provider.schedule.cycleDays) : '',
    quotas: provider.quotas.map((q) => ({
      ref: q.id,
      id: q.id,
      label: q.label,
      type: q.type,
      currency: q.currency ?? '',
      lowBalance: q.lowBalance == null ? '' : String(q.lowBalance),
      gates: q.gates ? [...q.gates] : null,
      subnote: q.subnote ?? '',
      value: typeof current[q.id] === 'number' ? String(current[q.id]) : '',
      originalValue: typeof current[q.id] === 'number' ? String(current[q.id]) : '',
      originalType: q.type,
    })),
    fits: { ...(provider.fits ?? {}) },
    surplus: provider.surplus
      ? { tool: provider.surplus.tool, weeklyRef: refOf(provider.surplus.weeklyQuotaId), sessionRef: refOf(provider.surplus.sessionQuotaId) }
      : { tool: '', weeklyRef: '', sessionRef: '' },
  }
}

// errors: [{path, message}] -> { [path]: message } (first message wins)
export function errorMap(errors = []) {
  const map = {}
  for (const { path, message } of errors) if (!(path in map)) map[path] = message
  return map
}
