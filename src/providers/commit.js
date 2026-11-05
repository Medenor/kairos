// Two-step persistence of a created provider (FR-021): the quota-state patch is written first and the
// definition second. State values for an id nothing defines are inert, so an interrupted save leaves
// harmless values and never a half-defined provider.
import { saveCatalogue } from './storage.js'
import { STATE_STORAGE_KEY } from './stateEffects.js'

// Writes the quota-state patch of an accepted action. Nothing to write means success.
export function writeStatePatch(storage, result) {
  const hasWrites = (result.effects?.stateWrites?.length ?? 1) > 0
  return hasWrites ? writeState(storage, result.state) : true
}

function writeState(storage, state) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false
    storage.setItem(STATE_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

/** Returns { ok, stateSaved, catalogueSaved }. The definition is only written when the state patch was. */
export function commitCreation({ stateStorage, catalogueStorage, result }) {
  // Nothing to write for the state (an edit without new readings): only the definition is saved.
  const hasWrites = (result.effects?.stateWrites?.length ?? 1) > 0
  const stateSaved = hasWrites ? writeState(stateStorage, result.state) : true
  if (!stateSaved) return { ok: false, stateSaved: false, catalogueSaved: false }
  const catalogueSaved = saveCatalogue(catalogueStorage, result.catalogue)
  return { ok: catalogueSaved, stateSaved, catalogueSaved }
}
