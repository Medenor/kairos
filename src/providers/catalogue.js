// Pure catalogue reducers (research D15). Each takes the catalogue, the quota state and an injected
// `now`/`newId`, and returns either { ok: true, catalogue, state, effects } or
// { ok: false, errors: [{ path, message }], catalogue, state } with the SAME catalogue and state
// references: nothing is half-created on refusal (FR-021). They never read a clock or a global.
import { isProviderId, isQuotaId, newProviderId, newQuotaId } from './ids.js'
import { activeProviders } from './runtime.js'
import { CYCLE_DAYS, PROVIDER_SCHEMA_VERSION, validateProvider } from './schema.js'
import { applyProviderStateEffects, readingWrites, resetDateWrite } from './stateEffects.js'

const refuse = (catalogue, state, errors) => ({ ok: false, errors, catalogue, state })

// `newId(kind)` with kind 'provider' | 'quota'. Defaults to random ids.
const defaultNewId = (kind) => (kind === 'provider' ? newProviderId() : newQuotaId())

function freshId(kind, newId, taken, isValid) {
  for (let i = 0; i < 100; i += 1) {
    const id = newId(kind)
    if (isValid(id) && !taken.has(id)) {
      taken.add(id)
      return id
    }
  }
  throw new Error(`Could not create a unique ${kind} id`)
}

export function normalizeSchedule(schedule) {
  const type = schedule?.type
  if (type === 'weekly' || type === 'monthly') return { type, cycleDays: CYCLE_DAYS[type] }
  if (type === 'none') return { type, cycleDays: null }
  return { type, cycleDays: schedule?.cycleDays }
}

// Trim and default form input into the shape validateProvider and the stored record share.
export function normalizeInput(input) {
  const src = input ?? {}
  return {
    name: typeof src.name === 'string' ? src.name.trim() : src.name,
    cost: src.cost ?? null,
    color: src.color ?? null,
    flags: Array.isArray(src.flags) ? src.flags.map((f) => (typeof f === 'string' ? f.trim() : f)).filter((f) => f !== '') : (src.flags ?? []),
    note: src.note ?? '',
    schedule: normalizeSchedule(src.schedule),
    quotas: Array.isArray(src.quotas) ? src.quotas : src.quotas,
    fits: src.fits ?? {},
    surplus: src.surplus ?? null,
  }
}

const activeNames = (catalogue, exceptId) =>
  activeProviders(catalogue).filter((p) => p.id !== exceptId).map((p) => p.name)

function buildQuota(q, id) {
  const isCurrency = q.type === 'currency'
  return {
    id,
    label: typeof q.label === 'string' ? q.label.trim() : q.label,
    type: q.type,
    currency: isCurrency ? q.currency : null,
    lowBalance: isCurrency ? (q.lowBalance ?? null) : null,
    gates: Array.isArray(q.gates) ? [...q.gates] : null,
    subnote: q.subnote ? q.subnote : null,
  }
}

function buildSurplus(surplus, refToId) {
  if (!surplus) return null
  const resolve = (ref) => (ref ? refToId.get(ref) ?? null : null)
  return { tool: surplus.tool, weeklyQuotaId: resolve(surplus.weeklyQuotaId), sessionQuotaId: resolve(surplus.sessionQuotaId) }
}

/**
 * Create a provider from form input. Quotas may carry a `ref` (any string, or an existing `id`) that
 * `surplus.weeklyQuotaId` / `sessionQuotaId` use to designate them; real quota ids are generated here.
 */
export function addProvider({ catalogue, state, input, now, newId = defaultNewId }) {
  const normalized = normalizeInput(input)
  const checked = validateProvider(normalized, { existingNames: activeNames(catalogue), requireValues: true })
  if (!checked.ok) return refuse(catalogue, state, checked.errors)

  const takenProviders = new Set(Object.keys(catalogue.providers))
  const providerId = freshId('provider', newId, takenProviders, isProviderId)
  const takenQuotas = new Set()
  const refToId = new Map()
  const quotas = normalized.quotas.map((q, i) => {
    const id = freshId('quota', newId, takenQuotas, isQuotaId)
    refToId.set(q.ref ?? q.id ?? `#${i}`, id)
    return buildQuota(q, id)
  })

  const stamp = now.toISOString()
  const provider = {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    id: providerId,
    status: 'active',
    name: normalized.name,
    cost: normalized.cost ? { amount: normalized.cost.amount, currency: normalized.cost.currency } : null,
    color: normalized.color,
    flags: normalized.flags,
    note: normalized.note,
    schedule: normalized.schedule,
    quotas,
    fits: { ...normalized.fits },
    surplus: buildSurplus(normalized.surplus, refToId),
    createdAt: stamp,
    updatedAt: stamp,
  }

  const stateWrites = [
    ...normalized.quotas.flatMap((q, i) => readingWrites(providerId, quotas[i].id, q.value, now)),
    resetDateWrite(providerId, null),
  ]
  const effects = { providerId, stateWrites }
  return {
    ok: true,
    catalogue: {
      ...catalogue,
      providers: { ...catalogue.providers, [providerId]: provider },
      order: [...catalogue.order, providerId],
    },
    state: applyProviderStateEffects(state, effects),
    effects,
  }
}
