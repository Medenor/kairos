import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeServer, setupDevice } from './engine.testkit.js'

// Two devices edit the same provider; device B ends up with a conflict waiting for the user's choice.
async function conflictedDevice() {
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
  assert.equal(b.snapshot().conflicts.length, 1)
  return { server, a, b, id }
}

test('a full pull does not overwrite a local edit that is waiting on a conflict (review finding)', async () => {
  const { b } = await conflictedDevice()
  await b.engine.refresh({ full: true })
  assert.equal(b.snapshot().providers[0].name, 'Beta edit', 'the local edit survives the pull')
  assert.equal(b.snapshot().conflicts.length, 1, 'the conflict is still listed')
})

test('"mine" after a full pull still pushes the local edit', async () => {
  const { server, b, id } = await conflictedDevice()
  await b.engine.refresh({ full: true })
  b.engine.actions.resolveConflict(`provider:${id}`, 'mine')
  await b.fire()
  assert.equal(server.byKey(`provider:${id}`).payload.name, 'Beta edit')
})
