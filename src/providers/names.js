// Display-name resolution for a provider id (research D11). Order: live provider, captured name,
// tombstone name, legacy table, then the id itself. Anything not live is labelled `removed`.
import { LEGACY_PROVIDER_NAMES } from './legacyProviders.js'

export function resolveProviderName(id, { catalogue, capturedName } = {}) {
  const entry = catalogue?.providers?.[id]
  if (entry?.status === 'active') return { name: entry.name, removed: false, source: 'live' }
  if (typeof capturedName === 'string' && capturedName !== '') return { name: capturedName, removed: true, source: 'captured' }
  if (entry?.status === 'removed') return { name: entry.name, removed: true, source: 'tombstone' }
  if (Object.hasOwn(LEGACY_PROVIDER_NAMES, id)) return { name: LEGACY_PROVIDER_NAMES[id], removed: true, source: 'legacy' }
  return { name: String(id), removed: true, source: 'unknown' }
}
