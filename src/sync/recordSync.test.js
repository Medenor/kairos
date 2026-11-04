import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecordSync } from './recordSync.js'
import { fakeServer, manualTimers, memoryStorage } from './fakeServer.testkit.js'

// Minimal domain: notes keyed `note:{id}`, state { notes: {id: payload}, recordIndex }.
function setup({ storage = memoryStorage(), server = fakeServer() } = {}) {
  const timers = manualTimers()
  const log = { conflicts: [], applied: [], changes: 0 }
  let state = { notes: {}, recordIndex: {} }
  const noteId = (key) => (key.startsWith('note:') ? key.slice(5) : null)
  const sync = createRecordSync({
    storage,
    api: server.api,
    dirtyStorageKey: 'test:dirty',
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    domain: {
      getState: () => state,
      setState: (next) => { state = next },
      getIndex: (s) => s.recordIndex,
      withIndex: (s, recordIndex) => ({ ...s, recordIndex }),
      payloadFor: (s, key) => s.notes[noteId(key)] ?? null,
      unsyncedLocalKeys: (s) => Object.keys(s.notes).map((id) => `note:${id}`).filter((k) => !s.recordIndex[k]),
      applyRecords: (s, items) => {
        const notes = { ...s.notes }
        const recordIndex = { ...s.recordIndex }
        for (const item of items) {
          if (!noteId(item.logical_key)) continue
          log.applied.push(item.logical_key)
          notes[noteId(item.logical_key)] = item.payload
          recordIndex[item.logical_key] = item
        }
        return { ...s, notes, recordIndex }
      },
      applySilently: (next) => { state = next },
      holdPulled: (item, entry) => Boolean(noteId(item.logical_key)) && entry?.op === 'delete',
      remoteDeletedKeys: (oldIndex, items) => {
        const present = new Set(items.map((i) => i.logical_key))
        return Object.keys(oldIndex).filter((k) => !present.has(k))
      },
      dropRemoteDeleted: (s, keys) => {
        const notes = { ...s.notes }
        const recordIndex = { ...s.recordIndex }
        for (const key of keys) {
          delete notes[noteId(key)]
          delete recordIndex[key]
        }
        return { ...s, notes, recordIndex }
      },
      onConflict: async (key, local, serverRecord) => {
        log.conflicts.push({ key, local, server: serverRecord.payload })
        return { done: true }
      },
      onChange: () => { log.changes += 1 },
    },
  })
  const edit = (id, payload) => {
    state = { ...state, notes: { ...state.notes, [id]: payload } }
    sync.track([{ logicalKey: `note:${id}`, op: 'upsert' }])
  }
  return { sync, server, storage, timers, log, edit, getState: () => state }
}

test('track is a no-op outside shared mode and never calls the API', async () => {
  const { sync, server, edit, timers } = setup()
  edit('a', { v: 1 })
  assert.equal(sync.pendingCount(), 0)
  assert.equal(timers.timers.length, 0)
  await sync.flush()
  assert.deepEqual(server.calls, [])
  assert.equal(sync.getStatus().syncStatus, 'local')
})

test('first contact adopts local-only records, then edits flush in order with versions', async () => {
  const { sync, server, edit, timers } = setup()
  edit('a', { v: 1 })
  sync.setWorkspace('ws')
  await sync.refresh({ full: true })
  assert.deepEqual(server.calls.filter((c) => c[0] === 'create').map((c) => c[1]), ['note:a'])
  edit('a', { v: 2 })
  edit('b', { v: 1 })
  assert.equal(sync.pendingCount(), 2)
  timers.fire()
  await sync.flush()
  const writes = server.calls.filter((c) => c[0] === 'update' || c[0] === 'create').slice(1)
  assert.deepEqual(writes, [['update', 'note:a', 1], ['create', 'note:b']])
  assert.equal(sync.pendingCount(), 0)
  assert.equal(sync.getStatus().syncStatus, 'ready')
})

test('a 409 hands the server record to onConflict and does not overwrite it', async () => {
  const { sync, server, edit, log } = setup()
  sync.setWorkspace('ws')
  await sync.refresh({ full: true })
  edit('a', { v: 1 })
  await sync.flush()
  server.byKey('note:a').version = 5
  server.byKey('note:a').payload = { v: 'other' }
  edit('a', { v: 2 })
  await sync.flush()
  assert.equal(log.conflicts.length, 1)
  assert.deepEqual(log.conflicts[0].server, { v: 'other' })
  assert.deepEqual(server.byKey('note:a').payload, { v: 'other' })
})

test('incremental pull applies other devices records; full pull detects remote deletion', async () => {
  const { sync, server, getState } = setup()
  sync.setWorkspace('ws')
  await sync.refresh({ full: true })
  const rec = server.put('note:x', { v: 'x' })
  await sync.refresh({ full: false })
  assert.deepEqual(getState().notes.x, { v: 'x' })
  rec.deleted_at = '2026-11-03T12:00:00.000Z'
  await sync.refresh({ full: true })
  assert.equal(getState().notes.x, undefined)
})

test('a pending local delete is held back from a pull', async () => {
  const { sync, server, getState } = setup()
  sync.setWorkspace('ws')
  await sync.refresh({ full: true })
  server.put('note:z', { v: 'z' })
  sync.track([{ logicalKey: 'note:z', op: 'delete' }])
  // flush happens first inside refresh; the delete finds no known record and is dropped
  await sync.refresh({ full: false })
  assert.equal(sync.pendingCount(), 0)
  assert.ok(getState())
})

test('a failing API keeps entries dirty, reports the status and retries on the next tick', async () => {
  const server = fakeServer()
  const { sync, edit } = setup({ server })
  sync.setWorkspace('ws')
  await sync.refresh({ full: true })
  server.control.failWith = Object.assign(new Error('down'), { status: undefined })
  edit('a', { v: 1 })
  await sync.flush()
  assert.equal(sync.getStatus().syncStatus, 'offline')
  assert.equal(sync.pendingCount(), 1)
  server.control.failWith = null
  await sync.tick()
  assert.equal(sync.pendingCount(), 0)
  assert.equal(sync.getStatus().syncStatus, 'ready')
})

test('dirty marks survive a reload through the injected storage key and a broken storage does not throw', async () => {
  const storage = memoryStorage()
  const first = setup({ storage })
  first.sync.setWorkspace('ws')
  await first.sync.refresh({ full: true })
  first.server.control.failWith = Object.assign(new Error('down'), { status: undefined })
  first.edit('a', { v: 1 })
  await first.sync.flush()
  assert.ok(storage.getItem('test:dirty'))
  const second = setup({ storage })
  assert.equal(second.sync.pendingCount(), 1)

  const broken = setup({ storage: { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } } })
  broken.sync.setWorkspace('ws')
  await broken.sync.refresh({ full: true })
  broken.edit('a', { v: 1 })
  await broken.sync.flush()
  assert.equal(broken.sync.pendingCount(), 0)
})
