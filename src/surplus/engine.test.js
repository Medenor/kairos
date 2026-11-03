import test from 'node:test'
import assert from 'node:assert/strict'
import { createSurplusEngine } from './engine.js'
import { SURPLUS_STORAGE_KEYS, loadIdeas } from './storage.js'

const CLOCK = ['2026-11-03T10:00:00.000Z', '2026-11-03T10:01:00.000Z', '2026-11-03T10:02:00.000Z', '2026-11-03T10:03:00.000Z']

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

// In-memory stand-in for the shared-state backend: versions, 409 with the server record, soft delete,
// duplicate logical keys, and a pull that never returns deleted records.
function fakeServer() {
  const records = new Map()
  let seq = 0
  let tickMs = 0
  const calls = []
  const stamp = () => new Date(Date.parse('2026-11-03T09:00:00.000Z') + (tickMs += 1000)).toISOString()
  const err = (status, message, details) => Object.assign(new Error(message), { status, details })
  const api = {
    async createRecord(ws, body) {
      calls.push(['create', body.logical_key])
      if ([...records.values()].some((r) => r.logical_key === body.logical_key)) throw err(409, 'dup')
      seq += 1
      const rec = { id: `rec-${seq}`, workspace_id: ws, record_type: body.record_type, logical_key: body.logical_key, payload: body.payload, version: 1, updated_at: stamp(), deleted_at: null }
      records.set(rec.id, rec)
      return structuredClone(rec)
    },
    async updateRecord(ws, id, body) {
      calls.push(['update', records.get(id)?.logical_key, body.expected_version])
      const rec = records.get(id)
      if (!rec || rec.deleted_at) throw err(404, 'not found')
      if (rec.version !== body.expected_version) throw err(409, 'conflict', { server_record: structuredClone(rec) })
      Object.assign(rec, { payload: body.payload, version: rec.version + 1, updated_at: stamp() })
      return structuredClone(rec)
    },
    async deleteRecord(ws, id) {
      calls.push(['delete', records.get(id)?.logical_key])
      records.get(id).deleted_at = stamp()
    },
    async syncPull(ws, cursor) {
      calls.push(['pull', cursor])
      const items = [...records.values()].filter((r) => !r.deleted_at && (!cursor || r.updated_at > cursor))
      return { items: structuredClone(items), next_cursor: items.length ? items[items.length - 1].updated_at : cursor }
    },
  }
  const put = (logicalKey, payload, extra = {}) => {
    seq += 1
    const rec = { id: `rec-${seq}`, workspace_id: 'ws', record_type: 'routing_config', logical_key: logicalKey, payload, version: 1, updated_at: stamp(), deleted_at: null, ...extra }
    records.set(rec.id, rec)
    return rec
  }
  return { api, records, calls, put, byKey: (k) => [...records.values()].find((r) => r.logical_key === k) }
}

function setup({ storage = memoryStorage(), server = fakeServer() } = {}) {
  let n = 0
  let ids = 0
  const timers = []
  const engine = createSurplusEngine({
    storage,
    api: server.api,
    now: () => new Date(CLOCK[Math.min(n++, CLOCK.length - 1)]),
    newId: () => `id-${(ids += 1)}`,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: (handle) => {
      if (timers[handle - 1]) timers[handle - 1].fn = null
    },
  })
  const fireTimers = async () => {
    for (const t of timers) if (t.fn) { const fn = t.fn; t.fn = null; fn() }
    await engine.flush()
  }
  return { engine, storage, server, timers, fireTimers }
}

test('works with no workspace and no network: actions persist locally and never call the API', async () => {
  const { engine, storage, server, timers } = setup()
  const added = engine.actions.addIdea({ text: 'offline idea' })
  assert.equal(added.ok, true)
  assert.equal(added.idea.id, 'id-1')
  assert.equal(engine.getSnapshot().sharedMode, false)
  assert.equal(engine.getSnapshot().syncStatus, 'local')
  assert.deepEqual(loadIdeas(storage).map((i) => i.text), ['offline idea'])
  assert.equal(server.calls.length, 0)
  assert.equal(timers.length, 0)
  assert.equal(engine.actions.setAutoRunEnabled(true).error.code, 'shared_mode_required')
  assert.equal(engine.actions.stopAutoRuns().ok, true)
  assert.equal(engine.getSnapshot().autoRunEnabled, false)
  assert.ok(storage.data.has(SURPLUS_STORAGE_KEYS.control))
  assert.equal(engine.actions.addIdea({ text: '' }).ok, false)
})

test('a fresh engine reloads what a previous one saved', () => {
  const storage = memoryStorage()
  setup({ storage }).engine.actions.addIdea({ text: 'kept' })
  assert.deepEqual(setup({ storage }).engine.getSnapshot().ideas.map((i) => i.text), ['kept'])
})

test('storage that refuses writes is reported, state stays usable in memory', () => {
  const broken = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  const { engine } = setup({ storage: broken })
  assert.equal(engine.actions.addIdea({ text: 'x' }).ok, true)
  assert.equal(engine.getSnapshot().storageOk, false)
  assert.equal(engine.getSnapshot().ideas.length, 1)
})

test('shared mode: first pull adopts local ideas, edits debounce into one update, versions come from the index', async () => {
  const { engine, server, timers, fireTimers } = setup()
  engine.actions.addIdea({ text: 'local first' })
  engine.setWorkspace('ws')
  await engine.refresh()
  assert.ok(server.byKey('idea:id-1'))
  assert.equal(engine.getSnapshot().syncStatus, 'ready')
  assert.equal(engine.getSnapshot().pendingCount, 0)

  timers.length = 0
  engine.actions.updateIdea('id-1', { priority: 'high' })
  engine.actions.updateIdea('id-1', { size: 'large' })
  assert.equal(timers.filter((t) => t.fn).length, 1) // one pending debounce
  assert.equal(timers.at(-1).ms, 220)
  assert.equal(engine.getSnapshot().pendingCount, 1)
  await fireTimers()
  const rec = server.byKey('idea:id-1')
  assert.equal(rec.version, 2)
  assert.deepEqual([rec.payload.priority, rec.payload.size], ['high', 'large'])
  assert.equal(engine.getSnapshot().pendingCount, 0)
})

test('a 409 refreshes the record and retries once with the merged idea (runner fields from the server)', async () => {
  const { engine, server, fireTimers } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.actions.addIdea({ text: 'contested' })
  await fireTimers()
  const rec = server.byKey('idea:id-1')
  // The runner claims the idea behind the browser's back.
  Object.assign(rec, { version: rec.version + 1, payload: { ...rec.payload, status: 'running', serviceId: 'claude', updatedAt: '2026-11-03T09:30:00.000Z' } })
  engine.actions.updateIdea('id-1', { priority: 'high' })
  await fireTimers()
  assert.equal(rec.version, 3)
  assert.equal(rec.payload.status, 'running')
  assert.equal(rec.payload.priority, 'high')
  assert.equal(engine.getState().ideas[0].status, 'running')
  assert.equal(engine.getSnapshot().syncStatus, 'ready')
})

test('deleteIdea soft-deletes remotely and the pulled set never brings it back', async () => {
  const { engine, server, fireTimers } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.actions.addIdea({ text: 'doomed' })
  await fireTimers()
  const id = server.byKey('idea:id-1').id
  engine.actions.deleteIdea('id-1')
  await fireTimers()
  assert.ok(server.records.get(id).deleted_at)
  await engine.refresh({ full: true })
  assert.equal(engine.getSnapshot().ideas.length, 0)
  engine.actions.addIdea({ text: 'next' })
  assert.equal(engine.getSnapshot().ideas[0].id, 'id-2') // ids are never reused
})

test('a pending local delete is not undone by a pull that still lists the record', async () => {
  const { engine, server } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.actions.addIdea({ text: 'x' })
  await engine.flush()
  server.api.deleteRecord = async () => { throw Object.assign(new Error('down'), {}) }
  engine.actions.deleteIdea('id-1')
  await engine.refresh({ full: true }) // flush fails (offline), pull still lists the record
  assert.equal(engine.getSnapshot().ideas.length, 0)
  assert.equal(engine.getSnapshot().pendingCount, 1)
})

test('remote deletes are found by diffing a full pull, incremental pulls do not drop anything', async () => {
  const { engine, server } = setup()
  server.put('idea:remote', { id: 'remote', text: 'from another device', context: '', workingFolder: null, priority: 'normal', size: 'medium', approvalRequested: false, order: 1, contentVersion: 1, status: 'waiting', createdAt: CLOCK[0], updatedAt: CLOCK[0], serviceId: null, resultDecision: null, lastRunId: null })
  engine.setWorkspace('ws')
  await engine.refresh()
  assert.deepEqual(engine.getSnapshot().ideas.map((i) => i.id), ['remote'])
  server.byKey('idea:remote').deleted_at = 'now'
  await engine.refresh({ full: false })
  assert.equal(engine.getSnapshot().ideas.length, 1)
  await engine.refresh({ full: true })
  assert.equal(engine.getSnapshot().ideas.length, 0)
})

test('pending local edits are flushed before a pull is applied', async () => {
  const { engine, server } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.actions.addIdea({ text: 'first' })
  await engine.flush()
  engine.actions.updateIdea('id-1', { text: 'edited locally' })
  server.calls.length = 0
  await engine.refresh()
  const order = server.calls.map((c) => c[0])
  assert.ok(order.indexOf('update') !== -1 && order.indexOf('update') < order.lastIndexOf('pull'))
  assert.equal(server.byKey('idea:id-1').payload.text, 'edited locally')
  assert.equal(engine.getSnapshot().ideas[0].text, 'edited locally')
})

test('a pulled policy is not applied while a local policy edit is unsynced, and the edit wins on push', async () => {
  const { engine, server } = setup()
  engine.actions.updatePolicy((p) => ({ ...p, projectsBaseFolder: '/remote' }))
  engine.setWorkspace('ws')
  await engine.refresh() // adopts the local policy
  const remote = server.byKey('surplus-policy')
  assert.equal(remote.payload.projectsBaseFolder, '/remote')

  engine.actions.updatePolicy((p) => ({ ...p, projectsBaseFolder: '/local' }))
  // Another device writes the policy before ours is flushed; the flush itself fails once (offline).
  Object.assign(remote, { version: 2, payload: { ...remote.payload, projectsBaseFolder: '/other-device' }, updated_at: '2030-01-01T00:00:00.000Z' })
  const realUpdate = server.api.updateRecord
  let failOnce = true
  server.api.updateRecord = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('offline') }
    return realUpdate(...args)
  }
  await engine.refresh({ full: true })
  assert.equal(engine.getState().policy.projectsBaseFolder, '/local')
  await engine.flush() // retry: the index holds the pulled version, local edit wins
  assert.equal(remote.payload.projectsBaseFolder, '/local')
  assert.equal(engine.getSnapshot().pendingCount, 0)
})

test('the stop is written to surplus-control and a stale server control does not undo it', async () => {
  const { engine, server } = setup()
  server.put('surplus-control', { autoRunEnabled: true, updatedAt: '2026-11-03T08:00:00.000Z' })
  engine.setWorkspace('ws')
  await engine.refresh()
  assert.equal(engine.getSnapshot().autoRunEnabled, true)
  engine.actions.stopAutoRuns()
  await engine.flush()
  assert.equal(server.byKey('surplus-control').payload.autoRunEnabled, false)
  await engine.refresh({ full: true })
  assert.equal(engine.getSnapshot().autoRunEnabled, false)
})

test('a failed push keeps the edit dirty and reports offline, the next flush sends it', async () => {
  const { engine, server } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  const realCreate = server.api.createRecord
  server.api.createRecord = async () => { throw new Error('Request failed') }
  engine.actions.addIdea({ text: 'queued' })
  await engine.flush()
  assert.equal(engine.getSnapshot().syncStatus, 'offline')
  assert.equal(engine.getSnapshot().pendingCount, 1)
  assert.equal(engine.getSnapshot().ideas.length, 1)
  server.api.createRecord = realCreate
  await engine.flush()
  assert.ok(server.byKey('idea:id-1'))
  assert.equal(engine.getSnapshot().pendingCount, 0)
})

test('dirty marks survive a reload and are pushed after the first pull', async () => {
  const storage = memoryStorage()
  const server = fakeServer()
  const first = setup({ storage, server })
  first.engine.setWorkspace('ws')
  await first.engine.refresh()
  const realCreate = server.api.createRecord
  server.api.createRecord = async () => { throw new Error('Request failed') }
  first.engine.actions.addIdea({ text: 'unsynced' })
  await first.engine.flush()
  server.api.createRecord = realCreate

  const second = setup({ storage, server })
  assert.equal(second.engine.getSnapshot().pendingCount, 1)
  second.engine.setWorkspace('ws')
  await second.engine.refresh()
  assert.equal(server.byKey('idea:id-1').payload.text, 'unsynced')
  assert.equal(second.engine.getSnapshot().pendingCount, 0)
})

test('a record deleted remotely while edited locally is dropped on the next push (no re-create)', async () => {
  const { engine, server, fireTimers } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.actions.addIdea({ text: 'x' })
  await fireTimers()
  server.byKey('idea:id-1').deleted_at = 'gone'
  engine.actions.updateIdea('id-1', { priority: 'high' })
  await fireTimers()
  assert.equal(engine.getSnapshot().ideas.length, 0)
  assert.equal(server.calls.filter((c) => c[0] === 'create' && c[1] === 'idea:id-1').length, 1)
})

test('switching to no workspace returns to local mode', async () => {
  const { engine } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  engine.setWorkspace('')
  assert.equal(engine.getSnapshot().syncStatus, 'local')
  assert.equal(engine.getSnapshot().sharedMode, false)
})

test('commit is the extension point for derived records: changed cycles are synced', async () => {
  const { engine, server } = setup()
  engine.setWorkspace('ws')
  await engine.refresh()
  const cycle = { serviceId: 'claude', resetDate: '2026-11-10', lastWeeklyRemainingPct: 40, readAt: CLOCK[0] }
  engine.commit({ ...engine.getState(), cycles: [cycle] })
  await engine.flush()
  assert.deepEqual(server.byKey('cycle:claude:2026-11-10').payload, cycle)
})
