import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider } from './catalogue.js'
import { commitCreation } from './commit.js'
import { emptyCatalogue } from './records.js'
import { loadCatalogue, saveCatalogue } from './storage.js'
import { STATE_STORAGE_KEY } from './stateEffects.js'
import { toRuntimeServices } from './runtime.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'
import { LEGACY_STATE } from './fixtures/legacyData.js'

const NOW = new Date('2026-03-04T10:00:00.000Z')

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

function addThree() {
  const newId = sequentialIds()
  let catalogue = emptyCatalogue()
  let state = {}
  const inputs = [
    sampleInput({ name: 'Weekly' }),
    sampleInput({ name: 'Monthly', schedule: { type: 'monthly' }, quotas: [{ label: 'Monthly quota', type: 'consumed_pct', value: 20 }], surplus: null }),
    sampleInput({ name: 'Pay as you go', cost: null, schedule: { type: 'none' }, quotas: [{ label: 'Balance', type: 'currency', currency: '$', value: 10 }], surplus: null }),
  ]
  for (const input of inputs) {
    const result = addProvider({ catalogue, state, input, now: NOW, newId })
    assert.equal(result.ok, true)
    ;({ catalogue, state } = result)
  }
  return { catalogue, state }
}

test('three providers of different kinds survive a reload with equal definitions and order (SC-006)', () => {
  const { catalogue } = addThree()
  const storage = memoryStorage()
  assert.equal(saveCatalogue(storage, catalogue), true)
  const fresh = loadCatalogue(memoryStorage(Object.fromEntries(storage.data)))
  assert.deepEqual(fresh.providers, catalogue.providers)
  assert.deepEqual(fresh.order, catalogue.order)
  assert.equal(toRuntimeServices(fresh).length, 3)
})

test('a catalogue loaded from empty storage has no provider (FR-001), even next to legacy data', () => {
  const storage = memoryStorage({ [STATE_STORAGE_KEY]: JSON.stringify(LEGACY_STATE) })
  const loaded = loadCatalogue(storage)
  assert.deepEqual(toRuntimeServices(loaded), [])
  assert.deepEqual(toRuntimeServices(loadCatalogue(memoryStorage())), [])
})

test('commitCreation writes the state patch first and the definition second', () => {
  const { catalogue, state } = addThree()
  const order = []
  const track = (name, store) => ({ ...store, setItem: (k, v) => { order.push(name); store.setItem(k, v) } })
  const stateStorage = track('state', memoryStorage())
  const catalogueStorage = track('catalogue', memoryStorage())
  const out = commitCreation({ stateStorage, catalogueStorage, result: { catalogue, state } })
  assert.deepEqual(out, { ok: true, stateSaved: true, catalogueSaved: true })
  assert.deepEqual(order, ['state', 'catalogue'])
  assert.deepEqual(JSON.parse(stateStorage.getItem(STATE_STORAGE_KEY)), state)
})

test('a catalogue write failure leaves only inert state values and no provider (FR-021)', () => {
  const { catalogue, state } = addThree()
  const stateStorage = memoryStorage()
  const catalogueStorage = { getItem: () => null, setItem() { throw new Error('quota exceeded') }, removeItem() {} }
  const out = commitCreation({ stateStorage, catalogueStorage, result: { catalogue, state } })
  assert.deepEqual(out, { ok: false, stateSaved: true, catalogueSaved: false })
  assert.deepEqual(toRuntimeServices(loadCatalogue(catalogueStorage)), [])
  assert.ok(stateStorage.getItem(STATE_STORAGE_KEY), 'quota-state values were written')
})

test('a state write failure stops before the definition is written', () => {
  const { catalogue, state } = addThree()
  const catalogueStorage = memoryStorage()
  const stateStorage = { setItem() { throw new Error('denied') } }
  const out = commitCreation({ stateStorage, catalogueStorage, result: { catalogue, state } })
  assert.deepEqual(out, { ok: false, stateSaved: false, catalogueSaved: false })
  assert.equal(catalogueStorage.data.size, 0)
})
