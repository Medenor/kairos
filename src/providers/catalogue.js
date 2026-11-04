// Pure catalogue reducers (research D15). Each takes the catalogue, the quota state and an injected
// `now`/`newId`, and returns either { ok: true, catalogue, state, effects } or
// { ok: false, errors: [{ path, message }], catalogue, state } with the SAME catalogue and state
// references: nothing is half-created on refusal (FR-021). They never read a clock or a global.
import { isProviderId, isQuotaId, newProviderId, newQuotaId } from './ids.js'
import { toTombstone } from './records.js'
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

// --- update -----------------------------------------------------------------------------------

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function scheduleChanged(before, after) {
  return before.type !== after.type || (before.cycleDays ?? null) !== (after.cycleDays ?? null)
}

/**
 * Edit a provider. `patch` holds any of the add-input fields (`quotas` replaces the whole list: an entry
 * with an `id` is an existing quota, one without is new and needs a `value`). Quota readings entered in
 * the patch are written with a fresh stamp. Extra patch keys: `confirmSchedule` and `lastResetDate`.
 * Refusals return the SAME catalogue and state; a schedule change with a recorded reset date returns
 * `needsConfirmation` and applies nothing until the patch carries `confirmSchedule: true`.
 */
export function updateProvider({ catalogue, state, id, patch, now, newId = defaultNewId }) {
  const current = catalogue.providers[id]
  if (!current || current.status !== 'active') {
    return refuse(catalogue, state, [{ path: 'id', message: 'This provider no longer exists.' }])
  }

  const { confirmSchedule = false, lastResetDate, ...fields } = patch ?? {}
  const merged = normalizeInput({
    name: current.name,
    cost: current.cost,
    color: current.color,
    flags: current.flags,
    note: current.note,
    schedule: current.schedule,
    quotas: current.quotas,
    fits: current.fits,
    surplus: current.surplus,
    ...fields,
  })

  const existingById = new Map(current.quotas.map((q) => [q.id, q]))
  const errors = []
  const checked = validateProvider(merged, { existingNames: activeNames(catalogue, id) })
  errors.push(...checked.errors)

  if (Array.isArray(merged.quotas)) {
    merged.quotas.forEach((q, i) => {
      const before = q.id ? existingById.get(q.id) : null
      if (q.id && !before) {
        errors.push({ path: `quotas[${i}].id`, message: 'Unknown quota.' })
      } else if (!before && q.value === undefined) {
        errors.push({ path: `quotas[${i}].value`, message: 'Enter the first reading for a new quota.' })
      } else if (before && before.type !== q.type && q.value === undefined) {
        // The stored number would mean something else under the new type (FR-007): never reinterpret it.
        errors.push({ path: `quotas[${i}].value`, message: 'Confirm or re-enter the value for the new quota type.' })
      }
    })
  }
  if (errors.length > 0) return refuse(catalogue, state, errors)

  const scheduleIsChanging = scheduleChanged(current.schedule, merged.schedule)
  const recordedReset = state?.[id]?.__last_reset_date ?? null
  if (scheduleIsChanging && recordedReset && !confirmSchedule) {
    return {
      ok: false,
      errors: [],
      needsConfirmation: { kind: 'schedule', lastResetDate: recordedReset },
      catalogue,
      state,
    }
  }

  const takenQuotas = new Set(current.quotas.map((q) => q.id))
  const refToId = new Map()
  const stateWrites = []
  const quotas = merged.quotas.map((q, i) => {
    const quotaId = q.id ?? freshId('quota', newId, takenQuotas, isQuotaId)
    refToId.set(q.ref ?? q.id ?? `#${i}`, quotaId)
    refToId.set(quotaId, quotaId)
    if (q.value !== undefined) stateWrites.push(...readingWrites(id, quotaId, q.value, now))
    return buildQuota(q, quotaId)
  })
  if (scheduleIsChanging && confirmSchedule && lastResetDate !== undefined) stateWrites.push(resetDateWrite(id, lastResetDate))

  const next = {
    ...current,
    name: merged.name,
    cost: merged.cost ? { amount: merged.cost.amount, currency: merged.cost.currency } : null,
    color: merged.color,
    flags: merged.flags,
    note: merged.note,
    schedule: merged.schedule,
    quotas,
    fits: { ...merged.fits },
    surplus: buildSurplus(merged.surplus, refToId),
  }

  const effects = { providerId: id, stateWrites }
  if (sameJson({ ...next, updatedAt: null }, { ...current, updatedAt: null }) && stateWrites.length === 0) {
    return { ok: true, catalogue, state, effects }
  }
  next.updatedAt = now.toISOString()
  return {
    ok: true,
    catalogue: { ...catalogue, providers: { ...catalogue.providers, [id]: next } },
    state: applyProviderStateEffects(state, effects),
    effects,
  }
}

// --- remove -----------------------------------------------------------------------------------

/**
 * Delete a provider: its record becomes a tombstone that keeps only the name at deletion, so history
 * can still name it. Readings stay in the state but are unread (nothing defines the id); its surplus
 * entry is pruned by the caller (`effects.policyPrune`). Recreating a provider with the same name gives
 * a new id and inherits nothing.
 */
export function removeProvider({ catalogue, state, id, now }) {
  const current = catalogue.providers[id]
  if (!current || current.status !== 'active') {
    return refuse(catalogue, state, [{ path: 'id', message: 'This provider no longer exists.' }])
  }
  return {
    ok: true,
    catalogue: {
      ...catalogue,
      providers: { ...catalogue.providers, [id]: toTombstone(current, now.toISOString()) },
      order: catalogue.order.filter((entry) => entry !== id),
    },
    state,
    effects: { providerId: id, stateWrites: [], stateKept: true, policyPrune: id },
  }
}
