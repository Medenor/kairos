// Local-first surplus store with optional shared sync (backing T024's useSurplusStore hook).
// Imperative and framework-free so it runs under node:test with a fake API. Everything that touches
// the outside world is injected: storage ({getItem,setItem,removeItem}), the API functions, `now`,
// `newId` and the timers. Nothing here reads a clock or a global.
//
// Local-first: every action updates memory and storage synchronously and never needs the network.
// Shared mode (a workspace id is set): edits are marked dirty, flushed after `debounceMs`, and pulled
// back with sync/pull. Writes and pulls are serialised, pending edits are flushed before a pull is
// applied, a pulled policy is not applied while a local policy edit is unsynced, and remote deletes
// are found by diffing a periodic full pull (sync/pull never returns deleted records).
import { applySurplusRecords, loadSurplusState, mergeIdeaAfterConflict, saveCycles, saveIdeas, savePolicy, saveRuns, saveSurplusState } from './storage.js'
import { validateIdeaRecord } from './ideas.js'
import { keyForPolicy, parseRecordKey } from './records.js'
import { createRecordSync } from '../sync/recordSync.js'
import * as store from './store.js'

const DIRTY_STORAGE_KEY = 'kairos:surplus:dirty'

const COLLECTIONS = ['ideas', 'policy', 'runs', 'cycles', 'control', 'lease']
const sameContent = (a, b) =>
  COLLECTIONS.every((k) => a[k] === b[k]) &&
  a.invalid.length === b.invalid.length &&
  a.invalid.every((entry, i) => JSON.stringify(entry) === JSON.stringify(b.invalid[i]))

/**
 * options: { storage, api: {createRecord, updateRecord, deleteRecord, syncPull}, now: () => Date,
 *            newId: () => string, debounceMs = 220, setTimer = setTimeout, clearTimer = clearTimeout }
 */
export function createSurplusEngine({
  storage,
  api,
  now,
  newId,
  debounceMs = 220,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let state = loadSurplusState(storage)
  let storageOk = true
  const listeners = new Set()
  let snapshot = null

  // --- snapshot / subscription (shape for useSyncExternalStore) -----------------------------

  function buildSnapshot() {
    const { syncStatus, syncMessage } = sync.getStatus()
    const workspaceId = sync.getWorkspaceId()
    snapshot = {
      ideas: store.sortIdeas(state.ideas),
      policy: state.policy,
      runs: state.runs,
      cycles: state.cycles,
      control: state.control,
      lease: state.lease,
      invalid: state.invalid,
      autoRunEnabled: state.control?.autoRunEnabled === true,
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

  // --- persistence --------------------------------------------------------------------------

  function persist(prev, next) {
    let ok = true
    if (prev.control !== next.control || prev.lease !== next.lease) ok = saveSurplusState(storage, next)
    else {
      if (prev.ideas !== next.ideas) ok = saveIdeas(storage, next.ideas) && ok
      if (prev.policy !== next.policy) ok = savePolicy(storage, next.policy) && ok
      if (prev.runs !== next.runs) ok = saveRuns(storage, next.runs) && ok
      if (prev.cycles !== next.cycles) ok = saveCycles(storage, next.cycles) && ok
    }
    storageOk = ok
  }

  // Applies a change that did not come from the user (pull, conflict resolution): persisted but
  // never marked dirty.
  function applySilently(next) {
    const prev = state
    state = next
    if (sameContent(prev, next)) return // e.g. an empty poll: only the record index moved
    persist(prev, next)
    emit()
  }

  // --- sync core wiring ---------------------------------------------------------------------

  const sync = createRecordSync({
    storage,
    api,
    dirtyStorageKey: DIRTY_STORAGE_KEY,
    debounceMs,
    setTimer,
    clearTimer,
    domain: {
      getState: () => state,
      setState: (next) => {
        state = next
      },
      getIndex: (s) => s.recordIndex,
      withIndex: (s, recordIndex) => ({ ...s, recordIndex }),
      payloadFor: store.payloadFor,
      unsyncedLocalKeys: store.unsyncedLocalKeys,
      applyRecords: applySurplusRecords,
      applySilently,
      // A pending local delete or an unsynced local policy edit must not be undone by what we pull.
      holdPulled: (item, entry) =>
        item?.record_type === 'routing_config' &&
        Boolean(parseRecordKey(item.logical_key)) &&
        (entry?.op === 'delete' || (item.logical_key === keyForPolicy() && entry?.op === 'upsert')),
      remoteDeletedKeys: store.remoteDeletedKeys,
      dropRemoteDeleted: store.dropRemoteDeleted,
      onNotFound: (key) => {
        if (parseRecordKey(key)?.kind !== 'idea') return false
        // Deleted on another device: honour the delete (re-creating a deleted key fails server side).
        applySilently(store.dropRemoteDeleted(state, [key]))
        return true
      },
      onConflict: async (key, local, server) => {
        const parsed = parseRecordKey(key)
        let payload = local
        if (parsed.kind === 'idea') {
          if (validateIdeaRecord(server.payload).valid) payload = mergeIdeaAfterConflict(local, server.payload)
          // The idea was edited again while the request was in flight: that edit is dirty and pushes next.
          if (store.payloadFor(state, key) !== local) return { done: true }
          if (payload !== local) applySilently({ ...state, ideas: state.ideas.map((i) => (i === local ? payload : i)) })
          if (JSON.stringify(payload) === JSON.stringify(server.payload)) return { done: true }
        } else if (parsed.kind === 'control' || parsed.kind === 'cycle') {
          const resolved = parsed.kind === 'control' ? store.resolveControlConflict(local, server.payload) : store.resolveCycleConflict(local, server.payload)
          if (resolved.winner === 'server') {
            applySilently(applySurplusRecords(state, [server]))
            return { done: true }
          }
        } else if (JSON.stringify(local) === JSON.stringify(server.payload)) {
          return { done: true } // policy: last writer wins, and nothing differs
        }
        return { payload }
      },
      onChange: emit,
    },
  })

  // Extension point (T028 cycle readings, anything else the hook derives): runs a pure
  // (state) => state update as a local edit. Changed browser-owned records are persisted, marked
  // dirty and synced in shared mode.
  function commit(next) {
    const prev = state
    if (next === prev) return
    state = next
    persist(prev, next)
    sync.track(store.diffDirty(prev, next))
    emit()
  }

  function run(action) {
    const result = action(state)
    if (result.ok) commit(result.state)
    const { state: _state, ...rest } = result
    return rest
  }

  // --- public API ---------------------------------------------------------------------------

  const { setWorkspace, refresh, tick, flush } = sync

  function needsShared(enabled) {
    return enabled && !sync.getWorkspaceId()
      ? { ok: false, error: { field: 'workspace', code: 'shared_mode_required', message: 'Automatic runs need shared mode.' } }
      : null
  }

  const actions = {
    addIdea: (input) => run((s) => store.addIdea(s, input, { id: newId(), now: now() })),
    updateIdea: (id, changes) => run((s) => store.updateIdea(s, id, changes, now())),
    reorder: (orderedIds) => run((s) => store.reorder(s, orderedIds, now())),
    archiveIdea: (id) => run((s) => store.archiveIdea(s, id, now())),
    deleteIdea: (id) => run((s) => store.deleteIdea(s, id)),
    requestApproval: (id) => run((s) => store.requestApproval(s, id, now())),
    markLaunchedManually: (id, serviceId) => run((s) => store.markLaunchedManually(s, id, serviceId, now())),
    decideRun: (ideaId, decision) => run((s) => store.decideRun(s, ideaId, decision, now())),
    updatePolicy: (next) => run((s) => store.updatePolicy(s, next)),
    setAutoRunEnabled: (enabled) => needsShared(enabled) ?? run((s) => store.setControl(s, enabled, now())),
    stopAutoRuns: () => run((s) => store.setControl(s, false, now())),
    refresh: () => refresh({ full: true }),
  }

  buildSnapshot()

  return {
    actions,
    commit,
    flush,
    refresh,
    tick,
    setWorkspace,
    getState: () => state,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => sync.dispose(),
  }
}
