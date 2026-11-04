// Maps stored providers to the runtime service shape the existing pure code reads (research D2):
// `evaluateSurplus`, cycle readings, snapshots, `getResetInfo` and the routing engine all receive
// these instead of the removed fixed list. Pure; tombstones never reach the runtime.
import { surplusProblems } from './surplusProfile.js'
import { compareByName } from './tiebreak.js'

const isActive = (entry) => entry && entry.status === 'active'
const isRemoved = (entry) => entry && entry.status === 'removed'

function ordered(entries, order = []) {
  const position = new Map(order.map((id, i) => [id, i]))
  return [...entries].sort((a, b) => {
    const pa = position.has(a.id) ? position.get(a.id) : Infinity
    const pb = position.has(b.id) ? position.get(b.id) : Infinity
    if (pa !== pb) return pa < pb ? -1 : 1
    return compareByName(a, b)
  })
}

export const activeProviders = (catalogue) => ordered(Object.values(catalogue?.providers ?? {}).filter(isActive), catalogue?.order)
export const removedProviders = (catalogue) => ordered(Object.values(catalogue?.providers ?? {}).filter(isRemoved), catalogue?.order)

export function toRuntimeService(provider) {
  const type = provider.schedule?.type ?? 'none'
  const eligible = surplusProblems(provider).length === 0
  return {
    id: provider.id,
    name: provider.name,
    color: provider.color ?? null,
    cost: provider.cost ? provider.cost.amount : null,
    costCurrency: provider.cost ? provider.cost.currency : null,
    flags: Array.isArray(provider.flags) ? [...provider.flags] : [],
    note: provider.note ?? '',
    resetType: type,
    resetCycleDays: type === 'none' ? null : provider.schedule.cycleDays,
    quotas: (provider.quotas ?? []).map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      currency: q.currency ?? null,
      lowBalance: q.lowBalance ?? null,
      gates: q.gates ? [...q.gates] : null,
      subnote: q.subnote ?? null,
    })),
    fits: { ...(provider.fits ?? {}) },
    surplus: eligible
      ? { tool: provider.surplus.tool, weeklyQuotaId: provider.surplus.weeklyQuotaId, sessionQuotaId: provider.surplus.sessionQuotaId }
      : null,
  }
}

export const toRuntimeServices = (catalogue) => activeProviders(catalogue).map(toRuntimeService)
