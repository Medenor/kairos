import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeServer, sampleInput, setupDevice } from './engine.testkit.js'
import { loadCatalogue } from './storage.js'
import { memoryStorage } from '../sync/fakeServer.testkit.js'
import { sequentialIds } from './fixtures/sampleProviders.js'

const rejectEverything = () => {
  const failure = Object.assign(new Error('network down'), { status: undefined })
  return fakeServer({ failWith: failure })
}

test('local actions never need the network: with an API that rejects every call, add, edit and delete still succeed (FR-025)', async () => {
  const dev = setupDevice({ server: rejectEverything() })
  const id = dev.add('Offline one')
  assert.equal(dev.snapshot().syncStatus, 'local')
  const edit = dev.engine.actions.updateProvider(id, { name: 'Offline renamed' }, { state: {} })
  assert.equal(edit.ok, true)
  const del = dev.engine.actions.removeProvider(id, { state: {} })
  assert.equal(del.ok, true)
  assert.equal(dev.server.calls.length, 0, 'no network call outside shared mode')
  assert.equal(dev.snapshot().providers.length, 0)
  dev.engine.setWorkspace('ws')
  await dev.engine.refresh({ full: true })
  assert.equal(dev.snapshot().syncStatus, 'offline')
  const again = dev.engine.actions.addProvider(sampleInput({ name: 'Still works' }), { state: {} })
  assert.equal(again.ok, true, 'shared mode with a dead network keeps working locally')
})

test('local actions persist to storage immediately and survive a reload', () => {
  const storage = memoryStorage()
  const dev = setupDevice({ storage })
  const id = dev.add('Persistent')
  assert.ok(loadCatalogue(storage).providers[id])
  const reloaded = setupDevice({ storage })
  assert.deepEqual(reloaded.snapshot().providers.map((p) => p.name), ['Persistent'])
  assert.deepEqual(reloaded.snapshot().order, [id])
})

test('beforeCommit runs before anything is persisted and aborting leaves nothing behind (FR-021)', () => {
  const storage = memoryStorage()
  const dev = setupDevice({ storage, failBeforeCommit: true })
  const result = dev.engine.actions.addProvider(sampleInput(), { state: {} })
  assert.equal(result.ok, false)
  assert.equal(dev.snapshot().providers.length, 0)
  assert.equal(storage.getItem('kairos:providers'), null)
})

test('in shared mode a created provider is POSTed and an edit PUTs with expected_version', async () => {
  const dev = setupDevice()
  dev.engine.setWorkspace('ws')
  await dev.engine.refresh({ full: true })
  const id = dev.add('Shared one')
  await dev.fire()
  const key = `provider:${id}`
  assert.deepEqual(dev.server.calls.filter((c) => c[0] === 'create').map((c) => c[1]).sort(), [key, 'catalogue-order'].sort())
  const created = dev.server.byKey(key)
  assert.equal(created.record_type, 'routing_config')
  assert.equal(created.payload.name, 'Shared one')
  dev.engine.actions.updateProvider(id, { name: 'Shared renamed' }, { state: {} })
  await dev.fire()
  assert.ok(dev.server.calls.some((c) => c[0] === 'update' && c[1] === key && c[2] === 1))
  assert.equal(dev.server.byKey(key).payload.name, 'Shared renamed')
  assert.equal(dev.server.byKey(key).version, 2)
})

test('edits flush after the debounce, not before', async () => {
  const dev = setupDevice()
  dev.engine.setWorkspace('ws')
  await dev.engine.refresh({ full: true })
  dev.add('Debounced')
  assert.equal(dev.server.calls.filter((c) => c[0] === 'create').length, 0, 'nothing written before the timer fires')
  assert.equal(dev.snapshot().pendingCount, 2)
  await dev.fire()
  assert.equal(dev.snapshot().pendingCount, 0)
})

test('a pull applies another device\'s provider and order records', async () => {
  const server = fakeServer()
  const a = setupDevice({ server })
  const b = setupDevice({ server })
  a.engine.setWorkspace('ws')
  b.engine.setWorkspace('ws')
  await a.engine.refresh({ full: true })
  await b.engine.refresh({ full: true })
  const id = a.add('From A')
  await a.fire()
  await b.engine.refresh({ full: false })
  assert.deepEqual(b.snapshot().providers.map((p) => p.name), ['From A'])
  assert.deepEqual(b.snapshot().order, [id])
  assert.ok(loadCatalogue(b.storage).providers[id], 'persisted on the pulling device')
})

test('two devices editing the same provider: the second save gets a 409, is exposed in conflicts and nothing is overwritten (US4-3, SC-007)', async () => {
  const server = fakeServer()
  const a = setupDevice({ server })
  const b = setupDevice({ server })
  a.engine.setWorkspace('ws')
  b.engine.setWorkspace('ws')
  await a.engine.refresh({ full: true })
  await b.engine.refresh({ full: true })
  const id = a.add('Shared')
  await a.fire()
  await b.engine.refresh({ full: false })

  a.engine.actions.updateProvider(id, { name: 'Alpha edit' }, { state: {} })
  b.engine.actions.updateProvider(id, { name: 'Beta edit' }, { state: {} })
  await a.fire()
  await b.fire()

  assert.equal(server.byKey(`provider:${id}`).payload.name, 'Alpha edit', 'the other device\'s version is not overwritten')
  const { conflicts } = b.snapshot()
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].id, id)
  assert.equal(conflicts[0].server.name, 'Alpha edit')
  assert.equal(conflicts[0].local.name, 'Beta edit')
  assert.equal(b.snapshot().providers[0].name, 'Beta edit', 'local edit stays visible until resolved')
})

test('resolving a conflict: keep theirs adopts their version, reapply mine writes over it on purpose', async () => {
  const setup = async () => {
    const server = fakeServer()
    const a = setupDevice({ server })
    const b = setupDevice({ server })
    for (const d of [a, b]) d.engine.setWorkspace('ws')
    await a.engine.refresh({ full: true })
    await b.engine.refresh({ full: true })
    const id = a.add('Shared')
    await a.fire()
    await b.engine.refresh({ full: false })
    a.engine.actions.updateProvider(id, { name: 'Alpha edit' }, { state: {} })
    b.engine.actions.updateProvider(id, { name: 'Beta edit' }, { state: {} })
    await a.fire()
    await b.fire()
    return { server, a, b, id }
  }

  const theirs = await setup()
  theirs.b.engine.actions.resolveConflict(`provider:${theirs.id}`, 'theirs')
  assert.equal(theirs.b.snapshot().providers[0].name, 'Alpha edit')
  assert.equal(theirs.b.snapshot().conflicts.length, 0)

  const mine = await setup()
  mine.b.engine.actions.resolveConflict(`provider:${mine.id}`, 'mine')
  await mine.b.fire()
  assert.equal(mine.server.byKey(`provider:${mine.id}`).payload.name, 'Beta edit')
  assert.equal(mine.b.snapshot().conflicts.length, 0)
})

test('the display order is last writer wins and never raises a conflict', async () => {
  const server = fakeServer()
  const a = setupDevice({ server })
  const b = setupDevice({ server, ids: sequentialIds(500) })
  for (const d of [a, b]) d.engine.setWorkspace('ws')
  await a.engine.refresh({ full: true })
  await b.engine.refresh({ full: true })
  a.add('One')
  await a.fire()
  await b.engine.refresh({ full: false })
  a.add('Two')
  b.add('Three')
  await a.fire()
  await b.fire()
  assert.equal(b.snapshot().conflicts.length, 0)
})
