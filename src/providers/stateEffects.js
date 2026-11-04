// Quota-state side effects of catalogue actions. A reducer never touches the quota state itself: it
// returns `effects.stateWrites` and this pure helper applies them in one commit, so the hooks that own
// the state (local or shared) persist them like any other reading.
import { RESET_DATE_KEY, quotaTimeKey } from '../utils.js'

export const STATE_STORAGE_KEY = 'kairos-ai-quota-router:state'

export function stateWrite(providerId, key, value) {
  return { providerId, key, value, logicalKey: `${providerId}:${key}` }
}

// Writes for a quota entered or re-entered now: its value and a reading stamp (FR-039).
export function readingWrites(providerId, quotaId, value, now) {
  return [stateWrite(providerId, quotaId, value), stateWrite(providerId, quotaTimeKey(quotaId), now.toISOString())]
}

export function resetDateWrite(providerId, value = null) {
  return stateWrite(providerId, RESET_DATE_KEY, value)
}

export function applyProviderStateEffects(prevState, effects) {
  const writes = effects?.stateWrites ?? []
  if (writes.length === 0) return prevState
  const next = { ...prevState }
  for (const { providerId, key, value } of writes) next[providerId] = { ...next[providerId], [key]: value }
  return next
}
