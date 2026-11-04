// Local persistence of the provider catalogue: one key, `kairos:providers`. The storage object is
// injected; corrupt or foreign data loads as an empty catalogue and never throws (FR-001: nothing is
// pre-filled). Transient parts (record index, invalid records) are never persisted.
import { emptyCatalogue, validateProviderRecord } from './records.js'
import { PROVIDER_SCHEMA_VERSION } from './schema.js'
import { isProviderId } from './ids.js'

export const PROVIDERS_STORAGE_KEY = 'kairos:providers'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function loadCatalogue(storage) {
  let parsed
  try {
    const raw = storage?.getItem?.(PROVIDERS_STORAGE_KEY)
    parsed = raw ? JSON.parse(raw) : undefined
  } catch {
    return emptyCatalogue()
  }
  if (!isObject(parsed) || parsed.schemaVersion !== PROVIDER_SCHEMA_VERSION || !isObject(parsed.providers)) return emptyCatalogue()

  const providers = {}
  for (const [id, payload] of Object.entries(parsed.providers)) {
    if (isProviderId(id) && validateProviderRecord(payload, `provider:${id}`).ok) providers[id] = payload
  }
  const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => isProviderId(id) && providers[id]?.status === 'active') : []
  return { ...emptyCatalogue(), providers, order: [...new Set(order)] }
}

/** Returns true when written. A failing storage (quota, private mode) returns false instead of throwing. */
export function saveCatalogue(storage, catalogue) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false
    storage.setItem(
      PROVIDERS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: PROVIDER_SCHEMA_VERSION, providers: catalogue.providers, order: catalogue.order }),
    )
    return true
  } catch {
    return false
  }
}
