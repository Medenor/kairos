// Generic local-first record-sync core, extracted from the surplus engine (feature 007, research D3).
//
// It owns everything that is not domain vocabulary: the dirty set (persisted under an injected key),
// the debounced flush, serialised writes and pulls, create-or-update pushes, 409 resolution through a
// domain callback, incremental pulls with a cursor, a periodic full pull that detects remote deletes,
// and a status snapshot. The domain (surplus records, the provider catalogue, ...) supplies what a
// record means through the `domain` adapter. Nothing here reads a clock or a global: storage, API,
// timers and ids are injected so it runs under node:test with a fake API.
//
// domain adapter (all synchronous unless stated):
//   getState(), setState(next)             raw state access (no persistence, no emit)
//   getIndex(state), withIndex(state, ix)  logicalKey -> last valid shared record
//   isOwnKey(key)                          true for keys of this domain
//   payloadFor(state, key)                 payload to write, or null when the entity is gone locally
//   unsyncedLocalKeys(state)               local records the store does not hold yet
//   applyRecords(state, items)             fold pulled records into state
//   applySilently(next)                    apply a non-user change: persist + emit, never mark dirty
//   holdPulled(item, dirtyEntry)           true when a pulled record must not be applied now
//   remoteDeletedKeys(oldIndex, items)     keys that vanished in a full pull
//   dropRemoteDeleted(state, keys)         state without those records
//   onNotFound(key)                        optional, true when a 404 on update was handled
//   onConflict(key, local, server)         async; returns { done: true } or { payload } to retry with
//   onChange()                             called after every status change
const FULL_PULL_EVERY_TICKS = 10

const isNotFound = (error) => error?.status === 404
const isConflict = (error) => error?.status === 409

function readDirty(storage, key) {
  try {
    const raw = storage?.getItem?.(key)
    const entries = raw ? JSON.parse(raw) : []
    return new Map(Array.isArray(entries) ? entries.filter((e) => Array.isArray(e) && typeof e[0] === 'string') : [])
  } catch {
    return new Map()
  }
}

/**
 * options: { storage, api: {createRecord, updateRecord, deleteRecord, syncPull}, domain, dirtyStorageKey,
 *            recordType = 'routing_config', debounceMs = 220, setTimer = setTimeout, clearTimer = clearTimeout }
 */
export function createRecordSync({
  storage,
  api,
  domain,
  dirtyStorageKey,
  recordType = 'routing_config',
  debounceMs = 220,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let workspaceId = ''
  let cursor = null
  let indexReady = false // true once a full pull built the record index of the current workspace
  let tickCount = 0
  let flushTimer = null
  let chain = Promise.resolve()
  let status = { syncStatus: 'local', syncMessage: '' }
  let dirty = readDirty(storage, dirtyStorageKey) // logicalKey -> {op: 'upsert' | 'delete'}

  const emitChange = () => domain.onChange?.()

  function setStatus(syncStatus, syncMessage = '') {
    status = { syncStatus, syncMessage }
    emitChange()
  }

  function persistDirty() {
    try {
      if (dirty.size === 0) storage?.removeItem?.(dirtyStorageKey)
      else storage?.setItem?.(dirtyStorageKey, JSON.stringify([...dirty]))
    } catch {
      // Storage unavailable: dirty marks stay in memory, the first-pull adoption covers a reload.
    }
  }

  function setIndexEntry(key, record) {
    const state = domain.getState()
    domain.setState(domain.withIndex(state, { ...domain.getIndex(state), [key]: record }))
  }

  function dropIndexEntry(key) {
    const state = domain.getState()
    const index = { ...domain.getIndex(state) }
    delete index[key]
    domain.setState(domain.withIndex(state, index))
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

  // Marks local changes ([{logicalKey, op}]) dirty. A no-op outside shared mode.
  function track(changes) {
    if (!workspaceId || !changes.length) return
    for (const change of changes) dirty.set(change.logicalKey, { op: change.op })
    persistDirty()
    scheduleFlush()
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
      const known = domain.getIndex(domain.getState())[key]
      if (known) await api.deleteRecord(ws, known.id)
      dropIndexEntry(key)
      return
    }
    const payload = domain.payloadFor(domain.getState(), key)
    if (!payload) return // removed locally since it was marked
    const known = domain.getIndex(domain.getState())[key]
    try {
      const saved = known
        ? await api.updateRecord(ws, known.id, { expected_version: known.version, payload })
        : await api.createRecord(ws, { record_type: recordType, logical_key: key, payload })
      setIndexEntry(key, saved)
    } catch (error) {
      if (isNotFound(error) && known && domain.onNotFound?.(key)) return
      if (!isConflict(error)) throw error
      setStatus('conflict', 'Conflict detected. Refreshing the record.')
      await resolveConflict(key, payload, error)
    }
  }

  async function fetchRemote(key) {
    const result = await api.syncPull(workspaceId, null)
    return (result.items ?? []).find((item) => item?.record_type === recordType && item.logical_key === key) ?? null
  }

  // Refresh the record, let the domain merge, retry once. A second 409 propagates: the entry stays
  // dirty and the next tick starts over from a fresh server copy.
  async function resolveConflict(key, local, error) {
    const ws = workspaceId
    const server = error.details?.server_record ?? (await fetchRemote(key))
    if (!server) throw error
    setIndexEntry(key, server)

    const outcome = await domain.onConflict(key, local, server)
    if (outcome?.done) return

    const saved = await api.updateRecord(ws, server.id, { expected_version: server.version, payload: outcome?.payload ?? local })
    setIndexEntry(key, saved)
  }

  // --- pull ---------------------------------------------------------------------------------

  function applyPulled(items, full) {
    const oldIndex = domain.getIndex(domain.getState())
    const held = []
    const applicable = []
    for (const item of items) {
      const entry = dirty.get(item?.logical_key)
      if (domain.holdPulled(item, entry)) held.push(item)
      else applicable.push(item)
    }
    let next = domain.applyRecords(domain.getState(), applicable)
    if (held.length) {
      const index = { ...domain.getIndex(next) }
      for (const item of held) index[item.logical_key] = item
      next = domain.withIndex(next, index)
    }
    if (full && indexReady) {
      const gone = domain.remoteDeletedKeys(oldIndex, items).filter((key) => dirty.get(key)?.op !== 'delete')
      if (gone.length) {
        next = domain.dropRemoteDeleted(next, gone)
        for (const key of gone) dirty.delete(key)
        persistDirty()
      }
    }
    domain.applySilently(next)
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
        for (const key of domain.unsyncedLocalKeys(domain.getState())) if (!dirty.has(key)) dirty.set(key, { op: 'upsert' })
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
    domain.setState(domain.withIndex(domain.getState(), {}))
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

  return {
    track,
    flush,
    refresh,
    tick,
    setWorkspace,
    getWorkspaceId: () => workspaceId,
    getStatus: () => status,
    pendingCount: () => dirty.size,
    dispose() {
      if (flushTimer !== null) {
        clearTimer(flushTimer)
        flushTimer = null
      }
      if (workspaceId && indexReady && dirty.size) flush()
    },
  }
}
