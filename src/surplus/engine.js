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
import * as store from './store.js'

const DIRTY_STORAGE_KEY = 'kairos:surplus:dirty'
const FULL_PULL_EVERY_TICKS = 10

const isNotFound = (error) => error?.status === 404
const isConflict = (error) => error?.status === 409

const COLLECTIONS = ['ideas', 'policy', 'runs', 'cycles', 'control', 'lease']
const sameContent = (a, b) =>
  COLLECTIONS.every((k) => a[k] === b[k]) &&
  a.invalid.length === b.invalid.length &&
  a.invalid.every((entry, i) => JSON.stringify(entry) === JSON.stringify(b.invalid[i]))

function readDirty(storage) {
  try {
    const raw = storage?.getItem?.(DIRTY_STORAGE_KEY)
    const entries = raw ? JSON.parse(raw) : []
    return new Map(Array.isArray(entries) ? entries.filter((e) => Array.isArray(e) && typeof e[0] === 'string') : [])
  } catch {
    return new Map()
  }
}

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
  let workspaceId = ''
  let cursor = null
  let indexReady = false // true once a full pull built the record index of the current workspace
  let tickCount = 0
  let storageOk = true
  let flushTimer = null
  let chain = Promise.resolve()
  let status = { syncStatus: 'local', syncMessage: '' }
  let dirty = readDirty(storage) // logicalKey -> {op: 'upsert' | 'delete'}
  const listeners = new Set()
  let snapshot = null

  // --- snapshot / subscription (shape for useSyncExternalStore) -----------------------------

  function buildSnapshot() {
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
      syncStatus: status.syncStatus,
      syncMessage: status.syncMessage,
      pendingCount: dirty.size,
      storageOk,
    }
  }

  function emit() {
    buildSnapshot()
    for (const listener of [...listeners]) listener()
  }

  function setStatus(syncStatus, syncMessage = '') {
    status = { syncStatus, syncMessage }
    emit()
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

  function persistDirty() {
    try {
      if (dirty.size === 0) storage?.removeItem?.(DIRTY_STORAGE_KEY)
      else storage?.setItem?.(DIRTY_STORAGE_KEY, JSON.stringify([...dirty]))
    } catch {
      // Storage unavailable: dirty marks stay in memory, the first-pull adoption covers a reload.
    }
  }

  function setIndexEntry(key, record) {
    state = { ...state, recordIndex: { ...state.recordIndex, [key]: record } }
  }

  function dropIndexEntry(key) {
    const recordIndex = { ...state.recordIndex }
    delete recordIndex[key]
    state = { ...state, recordIndex }
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

  // Extension point (T028 cycle readings, anything else the hook derives): runs a pure
  // (state) => state update as a local edit. Changed browser-owned records are persisted, marked
  // dirty and synced in shared mode.
  function commit(next) {
    const prev = state
    if (next === prev) return
    state = next
    persist(prev, next)
    if (workspaceId) {
      const changes = store.diffDirty(prev, next)
      for (const change of changes) dirty.set(change.logicalKey, { op: change.op })
      if (changes.length) {
        persistDirty()
        scheduleFlush()
      }
    }
    emit()
  }

  function run(action) {
    const result = action(state)
    if (result.ok) commit(result.state)
    const { state: _state, ...rest } = result
    return rest
  }

  // --- serialised sync work -----------------------------------------------------------------

  function enqueue(task) {
    const promise = chain.then(task)
    chain = promise.catch(() => {})
    return promise
  }

  function scheduleFlush() {
    if (!workspaceId || !indexReady) return
    if (flushTimer !== null) clearTimer(flushTimer)
    flushTimer = setTimer(() => {
      flushTimer = null
      flush()
    }, debounceMs)
  }

  function flush() {
    if (flushTimer !== null) {
      clearTimer(flushTimer)
      flushTimer = null
    }
    return enqueue(flushInner)
  }

  function failureStatus(error) {
    // No HTTP status means the request never got an answer.
    setStatus(error?.status ? 'error' : 'offline', error?.message ?? 'Sync failed')
  }

  async function flushInner() {
    if (!workspaceId || !indexReady || dirty.size === 0) return
    const batch = [...dirty]
    dirty = new Map()
    persistDirty()
    for (let i = 0; i < batch.length; i += 1) {
      const [key, entry] = batch[i]
      try {
        await pushOne(key, entry)
      } catch (error) {
        // Keep this and the remaining entries (unless edited again meanwhile) and retry on a later tick.
        for (const [k, e] of batch.slice(i)) if (!dirty.has(k)) dirty.set(k, e)
        persistDirty()
        failureStatus(error)
        return
      }
    }
    setStatus('ready', 'Synced')
  }

  async function pushOne(key, entry) {
    const ws = workspaceId
    if (entry.op === 'delete') {
      const known = state.recordIndex[key]
      if (known) await api.deleteRecord(ws, known.id)
      dropIndexEntry(key)
      return
    }
    const payload = store.payloadFor(state, key)
    if (!payload) return // removed locally since it was marked
    const known = state.recordIndex[key]
    try {
      const saved = known
        ? await api.updateRecord(ws, known.id, { expected_version: known.version, payload })
        : await api.createRecord(ws, { record_type: 'routing_config', logical_key: key, payload })
      setIndexEntry(key, saved)
    } catch (error) {
      if (isNotFound(error) && known && parseRecordKey(key)?.kind === 'idea') {
        // Deleted on another device: honour the delete (re-creating a deleted key fails server side).
        applySilently(store.dropRemoteDeleted(state, [key]))
        return
      }
      if (!isConflict(error)) throw error
      setStatus('conflict', 'Conflict detected. Refreshing the record.')
      await resolveConflict(key, payload, error)
    }
  }

  async function fetchRemote(key) {
    const result = await api.syncPull(workspaceId, null)
    return (result.items ?? []).find((item) => item?.record_type === 'routing_config' && item.logical_key === key) ?? null
  }

  // Refresh the record, merge, retry once. A second 409 propagates: the entry stays dirty and the
  // next tick starts over from a fresh server copy.
  async function resolveConflict(key, local, error) {
    const ws = workspaceId
    const parsed = parseRecordKey(key)
    const server = error.details?.server_record ?? (await fetchRemote(key))
    if (!server) throw error
    setIndexEntry(key, server)

    let payload = local
    if (parsed.kind === 'idea') {
      if (validateIdeaRecord(server.payload).valid) payload = mergeIdeaAfterConflict(local, server.payload)
      // The idea was edited again while the request was in flight: that edit is dirty and pushes next.
      if (store.payloadFor(state, key) !== local) return
      if (payload !== local) applySilently({ ...state, ideas: state.ideas.map((i) => (i === local ? payload : i)) })
      if (JSON.stringify(payload) === JSON.stringify(server.payload)) return
    } else if (parsed.kind === 'control' || parsed.kind === 'cycle') {
      const resolved = parsed.kind === 'control' ? store.resolveControlConflict(local, server.payload) : store.resolveCycleConflict(local, server.payload)
      if (resolved.winner === 'server') {
        applySilently(applySurplusRecords(state, [server]))
        return
      }
    } else if (JSON.stringify(local) === JSON.stringify(server.payload)) {
      return // policy: last writer wins, and nothing differs
    }

    const saved = await api.updateRecord(ws, server.id, { expected_version: server.version, payload })
    setIndexEntry(key, saved)
  }

  // --- pull ---------------------------------------------------------------------------------

  function applyPulled(items, full) {
    const oldIndex = state.recordIndex
    const held = []
    const applicable = []
    for (const item of items) {
      const entry = dirty.get(item?.logical_key)
      const isSurplus = item?.record_type === 'routing_config' && parseRecordKey(item.logical_key)
      // A pending local delete or an unsynced local policy edit must not be undone by what we pull.
      if (isSurplus && (entry?.op === 'delete' || (item.logical_key === keyForPolicy() && entry?.op === 'upsert'))) held.push(item)
      else applicable.push(item)
    }
    let next = applySurplusRecords(state, applicable)
    if (held.length) {
      const recordIndex = { ...next.recordIndex }
      for (const item of held) recordIndex[item.logical_key] = item
      next = { ...next, recordIndex }
    }
    if (full && indexReady) {
      const gone = store.remoteDeletedKeys(oldIndex, items).filter((key) => dirty.get(key)?.op !== 'delete')
      if (gone.length) {
        next = store.dropRemoteDeleted(next, gone)
        for (const key of gone) dirty.delete(key)
        persistDirty()
      }
    }
    applySilently(next)
  }

  async function refreshInner(full, silent) {
    const ws = workspaceId
    if (!ws) return
    if (!silent) setStatus(indexReady ? 'syncing' : 'connecting')
    try {
      if (indexReady) await flushInner() // pending local edits go out before anything is pulled
      const doFull = full || !indexReady
      const result = await api.syncPull(ws, doFull ? null : cursor)
      if (ws !== workspaceId) return
      applyPulled(result.items ?? [], doFull)
      cursor = result.next_cursor || cursor
      if (!indexReady) {
        indexReady = true
        // First contact: whatever exists only locally (offline creations, pre-workspace data) is adopted.
        for (const key of store.unsyncedLocalKeys(state)) if (!dirty.has(key)) dirty.set(key, { op: 'upsert' })
        persistDirty()
      }
      if (dirty.size) await flushInner()
      else if (!silent || status.syncStatus !== 'ready') setStatus('ready', 'Synced')
    } catch (error) {
      failureStatus(error)
    }
  }

  // --- public API ---------------------------------------------------------------------------

  function setWorkspace(id) {
    const next = id || ''
    if (next === workspaceId) return
    workspaceId = next
    cursor = null
    indexReady = false
    tickCount = 0
    state = { ...state, recordIndex: {} }
    if (flushTimer !== null) {
      clearTimer(flushTimer)
      flushTimer = null
    }
    if (!next) {
      setStatus('local', '')
      return
    }
    setStatus('connecting', '')
    refresh({ full: true })
  }

  const refresh = ({ full = false, silent = false } = {}) => enqueue(() => refreshInner(full, silent))

  function tick() {
    tickCount += 1
    return refresh({ full: tickCount % FULL_PULL_EVERY_TICKS === 0, silent: true })
  }

  function needsShared(enabled) {
    return enabled && !workspaceId
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
    dispose() {
      if (flushTimer !== null) {
        clearTimer(flushTimer)
        flushTimer = null
      }
      if (workspaceId && indexReady && dirty.size) flush()
    },
  }
}
