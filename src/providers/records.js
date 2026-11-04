// Shared-record vocabulary of the provider catalogue (contracts/shared-records.md): logical keys,
// payload validators and the pure fold of pulled records into a local catalogue. A record from the
// store is untrusted data: an invalid one is listed with its errors and never applied.
import { isProviderId, isQuotaId } from './ids.js'
import { PROVIDER_SCHEMA_VERSION, validateProvider } from './schema.js'
import { normalizeName } from './tiebreak.js'

export const PROVIDER_KEY_PREFIX = 'provider:'
export const ORDER_KEY = 'catalogue-order'
export const RECORD_TYPE = 'routing_config'

export function providerKey(id) {
  if (!isProviderId(id)) throw new TypeError(`Not a provider id: ${String(id)}`)
  return `${PROVIDER_KEY_PREFIX}${id}`
}

export function parseCatalogueKey(key) {
  if (typeof key !== 'string') return null
  if (key === ORDER_KEY) return { kind: 'order' }
  if (key.startsWith(PROVIDER_KEY_PREFIX)) {
    const id = key.slice(PROVIDER_KEY_PREFIX.length)
    return isProviderId(id) ? { kind: 'provider', id } : null
  }
  return null
}

export const isCatalogueKey = (key) => parseCatalogueKey(key) !== null

export function emptyCatalogue() {
  return { schemaVersion: PROVIDER_SCHEMA_VERSION, providers: {}, order: [], recordIndex: {}, invalid: [] }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const isIso = (v) => typeof v === 'string' && ISO_RE.test(v) && Number.isFinite(Date.parse(v))

function validateSurplusShape(surplus, errors) {
  if (surplus === null || surplus === undefined) return
  if (!isObject(surplus) || typeof surplus.tool !== 'string') {
    return errors.push({ path: 'surplus', message: 'Surplus profile must hold a tool and two quota ids.' })
  }
  for (const field of ['weeklyQuotaId', 'sessionQuotaId']) {
    if (surplus[field] !== null && surplus[field] !== undefined && !isQuotaId(surplus[field])) {
      errors.push({ path: `surplus.${field}`, message: 'Must be a quota id.' })
    }
  }
}

/**
 * Validate the payload of `provider:{id}`: an active definition or a tombstone. `logicalKey` is optional;
 * when given, the payload id must equal its suffix. Returns { ok, kind: 'provider'|'tombstone'|null, errors }.
 */
export function validateProviderRecord(payload, logicalKey) {
  const errors = []
  const fail = (path, message) => errors.push({ path, message })
  if (!isObject(payload)) return { ok: false, kind: null, errors: [{ path: '', message: 'Record must be an object.' }] }
  if (payload.schemaVersion !== PROVIDER_SCHEMA_VERSION) fail('schemaVersion', `Must be ${PROVIDER_SCHEMA_VERSION}.`)
  if (!isProviderId(payload.id)) fail('id', 'Must be a provider id.')
  if (logicalKey !== undefined) {
    const parsed = parseCatalogueKey(logicalKey)
    if (parsed?.kind !== 'provider' || parsed.id !== payload.id) fail('id', 'Does not match the record key.')
  }

  if (payload.status === 'removed') {
    if (typeof payload.name !== 'string' || payload.name.trim() === '' || payload.name.length > 60) fail('name', 'A removed provider keeps its name (1 to 60 characters).')
    if (!isIso(payload.removedAt)) fail('removedAt', 'Must be an ISO timestamp.')
    return { ok: errors.length === 0, kind: 'tombstone', errors }
  }
  if (payload.status !== 'active') {
    fail('status', 'Must be active or removed.')
    return { ok: false, kind: null, errors }
  }

  errors.push(...validateProvider(payload).errors)
  if (Array.isArray(payload.quotas)) {
    payload.quotas.forEach((q, i) => {
      if (isObject(q) && !isQuotaId(q.id)) fail(`quotas[${i}].id`, 'Must be a quota id.')
    })
  }
  validateSurplusShape(payload.surplus, errors)
  if (!isIso(payload.createdAt)) fail('createdAt', 'Must be an ISO timestamp.')
  if (!isIso(payload.updatedAt)) fail('updatedAt', 'Must be an ISO timestamp.')
  return { ok: errors.length === 0, kind: 'provider', errors }
}

export function validateOrderPayload(payload) {
  const errors = []
  if (!isObject(payload)) return { ok: false, errors: [{ path: '', message: 'Record must be an object.' }] }
  if (payload.schemaVersion !== PROVIDER_SCHEMA_VERSION) errors.push({ path: 'schemaVersion', message: `Must be ${PROVIDER_SCHEMA_VERSION}.` })
  if (!Array.isArray(payload.ids) || !payload.ids.every(isProviderId) || new Set(payload.ids).size !== payload.ids.length) {
    errors.push({ path: 'ids', message: 'Must be a list of distinct provider ids.' })
  }
  if (!isIso(payload.updatedAt)) errors.push({ path: 'updatedAt', message: 'Must be an ISO timestamp.' })
  return { ok: errors.length === 0, errors }
}

export function toTombstone(provider, removedAt) {
  return { schemaVersion: PROVIDER_SCHEMA_VERSION, id: provider.id, status: 'removed', name: provider.name, removedAt }
}

const versionOf = (record) => (typeof record?.version === 'number' ? record.version : undefined)

// Whether an incoming record must be ignored because the local entry is newer or final.
function isStale(local, incoming, knownVersion) {
  const incomingVersion = versionOf(incoming)
  if (knownVersion !== undefined && incomingVersion !== undefined && incomingVersion < knownVersion) return true
  if (local?.status === 'removed' && incoming.payload.status === 'active') {
    // A removed provider is never resurrected by a stale active record.
    if (knownVersion !== undefined && incomingVersion !== undefined) return incomingVersion <= knownVersion
    return Date.parse(incoming.payload.updatedAt) <= Date.parse(local.removedAt)
  }
  return false
}

/**
 * Fold pulled shared records into the catalogue. Returns a new catalogue; the input is untouched.
 * Other record types and other namespaces are ignored. `invalid` lists rejected records with errors.
 */
export function applyCatalogueRecords(base, items = []) {
  let providers = base.providers
  let order = base.order
  let orderUpdatedAt = base.orderUpdatedAt
  const recordIndex = { ...base.recordIndex }
  let invalid = base.invalid
  let changed = false

  const setInvalid = (key, entry) => {
    invalid = invalid.filter((e) => e.key !== key)
    if (entry) invalid = [...invalid, entry]
  }

  for (const item of items) {
    if (item?.record_type !== RECORD_TYPE) continue
    const parsed = parseCatalogueKey(item.logical_key)
    if (!parsed) continue
    const key = item.logical_key

    if (item.deleted_at) {
      // Removed on the server without a tombstone (e.g. a restored backup): keep what we know as removed.
      if (parsed.kind === 'provider' && providers[parsed.id]?.status === 'active') {
        const local = providers[parsed.id]
        providers = { ...providers, [parsed.id]: toTombstone(local, isIso(item.deleted_at) ? item.deleted_at : local.updatedAt) }
        order = order.filter((id) => id !== parsed.id)
        changed = true
      }
      delete recordIndex[key]
      continue
    }

    if (parsed.kind === 'order') {
      const checked = validateOrderPayload(item.payload)
      if (!checked.ok) {
        setInvalid(key, { id: null, key, errors: checked.errors })
        continue
      }
      setInvalid(key, null)
      const known = versionOf(recordIndex[key])
      if (known !== undefined && versionOf(item) !== undefined && versionOf(item) < known) continue
      recordIndex[key] = item
      order = item.payload.ids
      orderUpdatedAt = item.payload.updatedAt
      changed = true
      continue
    }

    const checked = validateProviderRecord(item.payload, key)
    if (!checked.ok) {
      setInvalid(key, { id: parsed.id, key, errors: checked.errors })
      continue
    }
    setInvalid(key, null)
    const local = providers[parsed.id]
    const knownVersion = versionOf(recordIndex[key])
    if (isStale(local, item, knownVersion)) continue
    // A tombstone beats any older or equal definition; a newer local definition (restore) is kept.
    if (checked.kind === 'tombstone' && local?.status === 'active' && knownVersion !== undefined && versionOf(item) !== undefined && versionOf(item) < knownVersion) continue
    recordIndex[key] = item
    providers = { ...providers, [parsed.id]: item.payload }
    if (checked.kind === 'tombstone') order = order.filter((id) => id !== parsed.id)
    changed = true
  }

  if (!changed && invalid === base.invalid && Object.keys(recordIndex).length === Object.keys(base.recordIndex).length) {
    return { ...base, recordIndex }
  }
  return { ...base, providers, order, ...(orderUpdatedAt ? { orderUpdatedAt } : {}), recordIndex, invalid }
}

/**
 * Ids of active providers whose normalised name equals that of an earlier-created active provider
 * (earlier createdAt wins, then the smaller id): duplicates created offline on two devices (FR-002).
 */
export function nameConflicts(catalogue) {
  const active = Object.values(catalogue?.providers ?? {}).filter((p) => p?.status === 'active')
  const byName = new Map()
  for (const p of active) {
    const name = normalizeName(p.name)
    byName.set(name, [...(byName.get(name) ?? []), p])
  }
  const later = []
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || (a.id < b.id ? -1 : 1))
    later.push(...sorted.slice(1).map((p) => p.id))
  }
  return later.sort()
}
