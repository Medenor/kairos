import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { writeStatePatch } from '../providers/commit'
import { createCatalogueEngine } from '../providers/engine'
import { createRecord, deleteRecord, getWorkspaceId, syncPull, updateRecord } from '../services/sharedStateApi'

const POLL_MS = 3000
const API = { createRecord, updateRecord, deleteRecord, syncPull }

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function detectWorkspaceId() {
  try {
    return getWorkspaceId()
  } catch {
    return ''
  }
}

// Provider catalogue: local-first, with shared sync when a workspace id is set. All logic lives in
// src/providers (pure reducers and the engine); this hook injects the browser edge (localStorage, clock,
// API client, workspace id) and exposes the engine's snapshot to React.
//
// Return value: catalogue (stored shape: providers by id incl. tombstones, order), providers (stored,
// active), runtimeProviders (what routing and surplus read), order, invalid[], conflicts[],
// nameConflicts[] (ids), removedElsewhere[], sharedMode, syncStatus, syncMessage, pendingCount, plus actions:
//   addProvider(input, { state, now? })        -> { ok, errors?, effects? }
//   updateProvider(id, patch, { state, now? }) -> { ok, errors?, needsConfirmation?, effects? }
//   removeProvider(id, { state, now? })        -> { ok, errors?, effects? }
//   resolveConflict(key, 'theirs' | 'mine'), dismissRemovedNotice(id), cancel()
// `state` is the current quota state. An accepted action writes the quota-state patch to storage first and
// the definition second (FR-021); the caller applies `result.effects` to its live state afterwards.
export function useCatalogue(options = {}) {
  const [engine] = useState(() =>
    createCatalogueEngine({
      storage: browserStorage(),
      api: API,
      now: () => new Date(),
      beforeCommit: (result) => writeStatePatch(browserStorage(), result),
    })
  )
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  // useSharedQuotaState stores the workspace id once it is known, so keep watching when none is given.
  const [detectedWorkspaceId, setDetectedWorkspaceId] = useState(detectWorkspaceId)
  useEffect(() => {
    const timer = setInterval(() => setDetectedWorkspaceId(detectWorkspaceId()), POLL_MS)
    return () => clearInterval(timer)
  }, [])
  const workspaceId = options.workspaceId || detectedWorkspaceId

  useEffect(() => {
    engine.setWorkspace(workspaceId)
  }, [engine, workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    const timer = setInterval(engine.tick, POLL_MS)
    const onHide = () => engine.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', onHide)
    }
  }, [engine, workspaceId])

  useEffect(() => () => engine.dispose(), [engine])

  return useMemo(
    () => ({
      ...snapshot,
      addProvider: engine.actions.addProvider,
      updateProvider: engine.actions.updateProvider,
      removeProvider: engine.actions.removeProvider,
      resolveConflict: engine.actions.resolveConflict,
      dismissRemovedNotice: engine.actions.dismissRemovedNotice,
      // Cancelling a form or dialog calls nothing: no catalogue action exists for it, by construction.
      cancel: () => {},
      engine,
    }),
    [snapshot, engine]
  )
}
