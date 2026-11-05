// Local-first provider catalogue with optional shared sync, built on the generic record-sync core
// (src/sync/recordSync.js). Imperative and framework-free so it runs under node:test with a fake API.
// Everything outside is injected: storage, API functions, `now`, `newId`, timers.
//
// Local-first: every action updates memory and storage synchronously and never needs the network.
// Shared mode (a workspace id is set): edits are marked dirty, flushed after `debounceMs`, and pulled
// back with sync/pull. One record per provider (`provider:{id}`, a tombstone on deletion) plus one
// `catalogue-order` record. A 409 never overwrites the other device's version: it is listed in
// `conflicts` and the user keeps theirs or reapplies mine. A tombstone always wins over an edit.
import { addProvider, duplicateProvider, removeProvider, reorderProviders, updateProvider } from './catalogue.js'
import { ORDER_KEY, RECORD_TYPE, applyCatalogueRecords, nameConflicts, parseCatalogueKey, providerKey } from './records.js'
import { loadCatalogue, saveCatalogue } from './storage.js'
import { activeProviders, removedProviders, toRuntimeServices } from './runtime.js'
import { createRecordSync } from '../sync/recordSync.js'

const DIRTY_STORAGE_KEY = 'kairos:providers:dirty'
const EPOCH = '1970-01-01T00:00:00.000Z'

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const sameInvalid = (a, b) => a.length === b.length && a.every((entry, i) => JSON.stringify(entry) === JSON.stringify(b[i]))

// Records to write after a local change: every provider record whose object changed, and the order.
export function diffDirty(prev, next) {
  const changes = []
  for (const [id, payload] of Object.entries(next.providers)) {
    if (prev.providers[id] !== payload) changes.push({ logicalKey: providerKey(id), op: 'upsert' })
  }
  if (!sameList(prev.order, next.order)) changes.push({ logicalKey: ORDER_KEY, op: 'upsert' })
  return changes
}

/**
 * options: { storage, api: {createRecord, updateRecord, deleteRecord, syncPull}, now: () => Date,
 *            newId?: (kind) => string, beforeCommit?: (result) => boolean | void, debounceMs = 220,
 *            setTimer = setTimeout, clearTimer = clearTimeout }
 * `beforeCommit(result)` runs after a reducer accepted an action and before anything is persisted: the
 * caller writes the quota-state patch there (state first, definition second, FR-021). Returning false
 * aborts the action.
 */
export function createCatalogueEngine({
  storage,
  api,
  now,
  newId,
  beforeCommit,
  debounceMs = 220,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let catalogue = loadCatalogue(storage)
  let storageOk = true
  const conflicts = new Map() // logical key -> { key, id, name, local, server, serverRecord }
  let removedElsewhere = [] // [{ id, name }]
  const listeners = new Set()
  let snapshot = null

  const nowIso = () => now().toISOString()

  // --- snapshot / subscription (shape for useSyncExternalStore) ------------------------------

  function buildSnapshot() {
    const { syncStatus, syncMessage } = sync.getStatus()
    const workspaceId = sync.getWorkspaceId()
    snapshot = {
      catalogue,
      providers: activeProviders(catalogue),
      runtimeProviders: toRuntimeServices(catalogue),
      removedTombstones: removedProviders(catalogue).map((t) => ({ id: t.id, name: t.name, removedAt: t.removedAt })),
      order: catalogue.order,
      invalid: catalogue.invalid,
      conflicts: [...conflicts.values()],
      nameConflicts: nameConflicts(catalogue),
      removedElsewhere,
      workspaceId,
      sharedMode: Boolean(workspaceId),
      syncStatus,
      syncMessage,
      pendingCount: sync.pendingCount(),
      storageOk,
    }
  }

  function emit() {
    buildSnapshot()
    for (const listener of [...listeners]) listener()
  }

  function persist(next) {
    storageOk = saveCatalogue(storage, next)
  }

  // A change that did not come from the user (pull, conflict resolution): persisted, never marked dirty.
  function applySilently(next) {
    const prev = catalogue
    catalogue = next
    if (prev.providers === next.providers && prev.order === next.order && sameInvalid(prev.invalid, next.invalid)) return // only the index moved
    if (prev.providers !== next.providers || prev.order !== next.order) persist(next)
    emit()
  }

  // --- sync core wiring ---------------------------------------------------------------------

  const keyOf = (key) => parseCatalogueKey(key)

  const sync = createRecordSync({
    storage,
    api,
    dirtyStorageKey: DIRTY_STORAGE_KEY,
    debounceMs,
    setTimer,
    clearTimer,
    domain: {
      getState: () => catalogue,
      setState: (next) => {
        catalogue = next
      },
      getIndex: (c) => c.recordIndex,
      withIndex: (c, recordIndex) => ({ ...c, recordIndex }),
      payloadFor: (c, key) => {
        const parsed = keyOf(key)
        if (parsed?.kind === 'provider') return c.providers[parsed.id] ?? null
        if (parsed?.kind === 'order') return { schemaVersion: 1, ids: c.order, updatedAt: c.orderUpdatedAt ?? EPOCH }
        return null
      },
      unsyncedLocalKeys: (c) => {
        const keys = Object.keys(c.providers).map(providerKey).filter((key) => !c.recordIndex[key])
        if (c.order.length > 0 && !c.recordIndex[ORDER_KEY]) keys.push(ORDER_KEY)
        return keys
      },
      applyRecords: (c, items) => applyCatalogueRecords(c, items),
      applySilently,
      // A pending local edit of the same record is not overwritten by a pull: its push meets a 409 instead.
      // The same holds while a conflict on the record waits for the user's choice: the conflict clears the
      // dirty mark, so without this the next full pull would replace the local edit with the server copy.
      // The index already holds the server record (the sync core stored it), so "mine" pushes against it.
      holdPulled: (item, entry) =>
        item?.record_type === RECORD_TYPE && Boolean(keyOf(item.logical_key)) && (entry?.op === 'upsert' || conflicts.has(item.logical_key))
          ? 'skip'
          : false,
      remoteDeletedKeys: (oldIndex, items) => {
        const present = new Set(items.filter((i) => i?.record_type === RECORD_TYPE).map((i) => i.logical_key))
        return Object.keys(oldIndex).filter((key) => keyOf(key)?.kind === 'provider' && !present.has(key))
      },
      dropRemoteDeleted: (c, keys) =>
        applyCatalogueRecords(c, keys.map((key) => ({ record_type: RECORD_TYPE, logical_key: key, deleted_at: nowIso(), version: c.recordIndex[key]?.version ?? 0 }))),
      onConflict: async (key, local, server) => {
        const parsed = keyOf(key)
        if (parsed?.kind === 'order') return { payload: local } // last writer wins for the display order
        const serverPayload = server.payload
        if (serverPayload?.status === 'removed' && local?.status !== 'removed') {
          // A tombstone always wins over an edit: the edit is dropped and the provider stays removed.
          const name = local?.name ?? serverPayload.name
          applySilently(applyCatalogueRecords(catalogue, [server]))
          removedElsewhere = [...removedElsewhere, { id: parsed.id, name }]
          conflicts.delete(key)
          emit()
          return { done: true }
        }
        if (local?.status === 'removed') return { payload: local } // my deletion beats their edit
        if (JSON.stringify(local) === JSON.stringify(serverPayload)) return { done: true }
        conflicts.set(key, { key, id: parsed.id, name: local?.name ?? serverPayload?.name, local, server: serverPayload, serverRecord: server })
        emit()
        return { done: true }
      },
      onChange: emit,
    },
  })

  // --- local actions ------------------------------------------------------------------------

  function commit(next) {
    const prev = catalogue
    if (next === prev) return
    const orderChanged = !sameList(prev.order, next.order)
    catalogue = orderChanged ? { ...next, orderUpdatedAt: nowIso() } : next
    persist(catalogue)
    sync.track(diffDirty(prev, catalogue))
    emit()
  }

  function run(result) {
    if (!result.ok) return result
    if (beforeCommit && beforeCommit(result) === false) {
      return { ok: false, errors: [{ path: '', message: 'The readings could not be saved on this device.' }], catalogue: result.catalogue, state: result.state }
    }
    commit(result.catalogue)
    return result
  }

  const stamp = (opts) => opts?.now ?? now()

  const actions = {
    addProvider: (input, opts = {}) => run(addProvider({ catalogue, state: opts.state ?? {}, input, now: stamp(opts), newId })),
    updateProvider: (id, patch, opts = {}) => run(updateProvider({ catalogue, state: opts.state ?? {}, id, patch, now: stamp(opts), newId })),
    removeProvider: (id, opts = {}) => run(removeProvider({ catalogue, state: opts.state ?? {}, id, now: stamp(opts) })),
    duplicateProvider: (id, opts = {}) => run(duplicateProvider({ catalogue, state: opts.state ?? {}, id, now: stamp(opts), newId })),
    // One `catalogue-order` write: the display order never feeds a rule.
    reorderProviders: (ids) => run(reorderProviders({ catalogue, ids })),

    // 'theirs': take the other device's version. 'mine': push my version over theirs (current server version).
    resolveConflict(key, choice) {
      const conflict = conflicts.get(key)
      if (!conflict) return { ok: false }
      conflicts.delete(key)
      if (choice === 'theirs') {
        applySilently(applyCatalogueRecords(catalogue, [conflict.serverRecord]))
        emit()
      } else {
        sync.track([{ logicalKey: key, op: 'upsert' }])
        emit()
      }
      return { ok: true }
    },

    dismissRemovedNotice(id) {
      removedElsewhere = removedElsewhere.filter((entry) => entry.id !== id)
      emit()
    },

    refresh: () => sync.refresh({ full: true }),
  }

  buildSnapshot()

  return {
    actions,
    commit,
    run,
    flush: sync.flush,
    refresh: sync.refresh,
    tick: sync.tick,
    setWorkspace: sync.setWorkspace,
    getState: () => catalogue,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => sync.dispose(),
  }
}
