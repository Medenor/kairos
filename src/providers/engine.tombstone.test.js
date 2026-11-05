import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeServer, setupDevice } from './engine.testkit.js'

async function twoDevices() {
  const server = fakeServer()
  const a = setupDevice({ server })
  const b = setupDevice({ server })
  for (const d of [a, b]) d.engine.setWorkspace('ws')
  await a.engine.refresh({ full: true })
  await b.engine.refresh({ full: true })
  const id = a.add('Shared')
  await a.fire()
  await b.engine.refresh({ full: false })
  return { server, a, b, id }
}

test('device A deletes while device B edits from a stale version: B\'s edit is dropped and the provider is not resurrected', async () => {
  const { server, a, b, id } = await twoDevices()
  a.engine.actions.removeProvider(id, { state: {} })
  await a.fire()
  assert.equal(server.byKey(`provider:${id}`).payload.status, 'removed')

  b.engine.actions.updateProvider(id, { name: 'Late edit' }, { state: {} })
  await b.fire()

  assert.equal(server.byKey(`provider:${id}`).payload.status, 'removed', 'server still holds the tombstone')
  assert.equal(b.snapshot().providers.length, 0)
  assert.deepEqual(b.snapshot().removedElsewhere, [{ id, name: 'Late edit' }])
  assert.equal(b.snapshot().conflicts.length, 0)
  b.engine.actions.dismissRemovedNotice(id)
  assert.deepEqual(b.snapshot().removedElsewhere, [])
})

test('my deletion beats their stale edit: the tombstone is reapplied over the other version', async () => {
  const { server, a, b, id } = await twoDevices()
  a.engine.actions.updateProvider(id, { name: 'Edited elsewhere' }, { state: {} })
  await a.fire()
  b.engine.actions.removeProvider(id, { state: {} })
  await b.fire()
  assert.equal(server.byKey(`provider:${id}`).payload.status, 'removed')
  assert.equal(b.snapshot().conflicts.length, 0)
})

test('a deletion is a versioned PUT of a tombstone, never an HTTP delete', async () => {
  const { server, a, id } = await twoDevices()
  a.engine.actions.removeProvider(id, { state: {} })
  await a.fire()
  assert.equal(server.calls.some((c) => c[0] === 'delete'), false)
  assert.deepEqual(
    { ...server.byKey(`provider:${id}`).payload, removedAt: 'x' },
    { schemaVersion: 1, id, status: 'removed', name: 'Shared', removedAt: 'x' },
  )
})

test('a periodic full pull that no longer lists a record applies the removal locally', async () => {
  const { server, b, id } = await twoDevices()
  server.byKey(`provider:${id}`).deleted_at = '2026-03-10T00:00:00.000Z' // removed on the server without a tombstone
  await b.engine.refresh({ full: true })
  const entry = b.snapshot().catalogue.providers[id]
  assert.equal(entry.status, 'removed')
  assert.equal(entry.name, 'Shared')
  assert.equal(b.snapshot().providers.length, 0)
})

test('a tombstone pulled from another device removes the provider and is persisted', async () => {
  const { a, b, id } = await twoDevices()
  a.engine.actions.removeProvider(id, { state: {} })
  await a.fire()
  await b.engine.refresh({ full: false })
  assert.equal(b.snapshot().providers.length, 0)
  assert.equal(b.snapshot().catalogue.providers[id].status, 'removed')
  assert.deepEqual(b.snapshot().order, [])
})
