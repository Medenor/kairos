import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider, removeProvider } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { toRuntimeServices } from './runtime.js'
import { validateProviderRecord } from './records.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

const T0 = new Date('2026-03-04T10:00:00.000Z')
const T1 = new Date('2026-03-06T08:00:00.000Z')

function setup() {
  const newId = sequentialIds()
  const first = addProvider({ catalogue: emptyCatalogue(), state: {}, input: sampleInput({ name: 'Keep' }), now: T0, newId })
  const second = addProvider({ catalogue: first.catalogue, state: first.state, input: sampleInput({ name: 'Doomed' }), now: T0, newId })
  const [keepId, doomedId] = second.catalogue.order
  return { ...second, keepId, doomedId, newId }
}

test('the record becomes a tombstone with the name at deletion and the removal time', () => {
  const ctx = setup()
  const out = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.doomedId, now: T1 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.catalogue.providers[ctx.doomedId], {
    schemaVersion: 1, id: ctx.doomedId, status: 'removed', name: 'Doomed', removedAt: T1.toISOString(),
  })
  assert.equal(validateProviderRecord(out.catalogue.providers[ctx.doomedId], `provider:${ctx.doomedId}`).ok, true)
})

test('the id leaves the order and the runtime list; the other provider is untouched', () => {
  const ctx = setup()
  const out = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.doomedId, now: T1 })
  assert.deepEqual(out.catalogue.order, [ctx.keepId])
  assert.deepEqual(toRuntimeServices(out.catalogue).map((s) => s.id), [ctx.keepId])
  assert.equal(out.catalogue.providers[ctx.keepId], ctx.catalogue.providers[ctx.keepId])
})

test('effects list the policy prune and keep the quota entries, now unread', () => {
  const ctx = setup()
  const out = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.doomedId, now: T1 })
  assert.equal(out.effects.policyPrune, ctx.doomedId)
  assert.equal(out.effects.stateKept, true)
  assert.equal(out.state, ctx.state)
  assert.ok(out.state[ctx.doomedId])
  assert.equal(toRuntimeServices(out.catalogue).some((s) => s.id === ctx.doomedId), false)
})

test('removing an unknown or already removed id is a no-op error', () => {
  const ctx = setup()
  const gone = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: 'p_unknownzzzzz', now: T1 })
  assert.equal(gone.ok, false)
  assert.equal(gone.catalogue, ctx.catalogue)
  const once = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.doomedId, now: T1 })
  const twice = removeProvider({ catalogue: once.catalogue, state: once.state, id: ctx.doomedId, now: T1 })
  assert.equal(twice.ok, false)
  assert.equal(twice.catalogue, once.catalogue)
})

test('recreating a provider with the same name gives a new id and inherits nothing (FR-022)', () => {
  const ctx = setup()
  const removed = removeProvider({ catalogue: ctx.catalogue, state: ctx.state, id: ctx.doomedId, now: T1 })
  const again = addProvider({ catalogue: removed.catalogue, state: removed.state, input: sampleInput({ name: 'Doomed', quotas: [{ ref: 'a', label: 'W', type: 'consumed_pct', value: 5 }, { ref: 'b', label: 'S', type: 'consumed_pct', value: 6 }] }), now: T1, newId: ctx.newId })
  assert.equal(again.ok, true)
  const fresh = again.catalogue.order.find((id) => id !== ctx.keepId)
  assert.notEqual(fresh, ctx.doomedId)
  const freshQuotaIds = again.catalogue.providers[fresh].quotas.map((q) => q.id)
  for (const quotaId of freshQuotaIds) assert.equal(ctx.state[ctx.doomedId][quotaId], undefined, 'no quota id carried over')
  assert.equal(again.state[fresh].__last_reset_date, null)
})
