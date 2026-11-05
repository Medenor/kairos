import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider, reorderProviders } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { toRuntimeServices } from './runtime.js'
import { recommend } from '../routing/engine.js'
import { evaluateSurplus } from '../surplus/evaluation.js'
import { defaultPolicy, defaultProviderSurplus } from '../surplus/policy.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

const NOW = new Date(2026, 2, 4, 12)

function setup() {
  const newId = sequentialIds()
  let catalogue = emptyCatalogue()
  let state = {}
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const out = addProvider({ catalogue, state, input: sampleInput({ name }), now: NOW, newId })
    ;({ catalogue, state } = out)
  }
  return { catalogue, state, ids: catalogue.order }
}

test('reorderProviders persists the order', () => {
  const { catalogue, ids } = setup()
  const out = reorderProviders({ catalogue, ids: [ids[2], ids[0], ids[1]] })
  assert.equal(out.ok, true)
  assert.deepEqual(out.catalogue.order, [ids[2], ids[0], ids[1]])
  assert.deepEqual(toRuntimeServices(out.catalogue).map((s) => s.id), [ids[2], ids[0], ids[1]])
})

test('unknown and duplicate ids are ignored, providers missing from the list are appended in their order', () => {
  const { catalogue, ids } = setup()
  const out = reorderProviders({ catalogue, ids: ['p_unknownzzzzz', ids[1], ids[1]] })
  assert.deepEqual(out.catalogue.order, [ids[1], ids[0], ids[2]])
})

test('an unchanged order returns the same catalogue reference', () => {
  const { catalogue, ids } = setup()
  assert.equal(reorderProviders({ catalogue, ids }).catalogue, catalogue)
})

test('removed providers are never put back in the order', () => {
  const { catalogue, ids } = setup()
  const removed = { ...catalogue, providers: { ...catalogue.providers, [ids[1]]: { schemaVersion: 1, id: ids[1], status: 'removed', name: 'Beta', removedAt: NOW.toISOString() } }, order: [ids[0], ids[2]] }
  assert.deepEqual(reorderProviders({ catalogue: removed, ids: [ids[2], ids[1], ids[0]] }).catalogue.order, [ids[2], ids[0]])
})

test('recommend and evaluateSurplus give deep-equal results for any two orders (US6-2, FR-014)', () => {
  const { catalogue, state, ids } = setup()
  const stateAll = {}
  for (const id of ids) stateAll[id] = { ...state[id], __ts_x: null }
  const orders = [ids, [ids[2], ids[1], ids[0]], [ids[1], ids[2], ids[0]]]
  const reco = orders.map((order) => recommend({ task: 'coding_hard', providers: toRuntimeServices(reorderProviders({ catalogue, ids: order }).catalogue), state: stateAll, now: NOW }))
  assert.deepEqual(reco[1], reco[0])
  assert.deepEqual(reco[2], reco[0])
  const policy = defaultPolicy()
  for (const id of ids) policy.providers[id] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const surplus = orders.map((order) => {
    const out = evaluateSurplus({ now: NOW, state: stateAll, services: toRuntimeServices(reorderProviders({ catalogue, ids: order }).catalogue), policy, ideas: [], runs: [], folderChecks: null, mode: 'preview' })
    return { selected: out.selected, reason: out.reason }
  })
  assert.deepEqual(surplus[1], surplus[0])
  assert.deepEqual(surplus[2], surplus[0])
})
