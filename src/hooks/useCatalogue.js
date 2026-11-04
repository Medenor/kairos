import { useCallback, useMemo, useRef, useState } from 'react'
import { addProvider as addProviderReducer } from '../providers/catalogue'
import { commitCreation } from '../providers/commit'
import { activeProviders, toRuntimeServices } from '../providers/runtime'
import { loadCatalogue, saveCatalogue } from '../providers/storage'

function browserStorage() {
  try {
    return localStorage
  } catch {
    return null
  }
}

// Provider catalogue, local-first (shared mode is added with the sync engine). Every action is a thin
// delegation to a pure reducer plus a persistence step, so the rules live in src/providers.
export function useCatalogue({ onStateEffects } = {}) {
  const [catalogue, setCatalogue] = useState(() => loadCatalogue(browserStorage()))
  const catalogueRef = useRef(catalogue)

  const commit = useCallback((next) => {
    catalogueRef.current = next
    setCatalogue(next)
  }, [])

  // `state` is the current quota state. Creation is persisted state first, definition second
  // (commitCreation), so an interrupted save leaves inert values rather than a half-defined provider.
  const addProvider = useCallback(
    (input, { state, now = new Date() }) => {
      const result = addProviderReducer({ catalogue: catalogueRef.current, state, input, now })
      if (!result.ok) return result
      const storage = browserStorage()
      const saved = commitCreation({ stateStorage: storage, catalogueStorage: storage, result })
      if (!saved.stateSaved || !saved.catalogueSaved) {
        // Keep the session usable even when storage is unavailable.
        saveCatalogue(storage, result.catalogue)
      }
      onStateEffects?.(result.effects)
      commit(result.catalogue)
      return result
    },
    [commit, onStateEffects]
  )

  return useMemo(
    () => ({
      catalogue,
      providers: activeProviders(catalogue),
      runtimeProviders: toRuntimeServices(catalogue),
      order: catalogue.order,
      addProvider,
    }),
    [catalogue, addProvider]
  )
}
