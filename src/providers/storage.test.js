import test from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDERS_STORAGE_KEY, loadCatalogue, saveCatalogue } from './storage.js'
import { emptyCatalogue, toTombstone } from './records.js'
import { MONTHLY_ID, PAYG_ID, WEEKLY_ID, sampleCatalogue, sampleMonthly } from './fixtures/sampleProviders.js'
import { LEGACY_STATE } from './fixtures/legacyData.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

test('empty, corrupt and foreign data load as an empty catalogue and never throw', () => {
  assert.deepEqual(loadCatalogue(memoryStorage()), emptyCatalogue())
  assert.deepEqual(loadCatalogue(memoryStorage({ [PROVIDERS_STORAGE_KEY]: '{not json' })), emptyCatalogue())
  assert.deepEqual(loadCatalogue(memoryStorage({ [PROVIDERS_STORAGE_KEY]: '[1,2]' })), emptyCatalogue())
  assert.deepEqual(loadCatalogue(memoryStorage({ [PROVIDERS_STORAGE_KEY]: JSON.stringify({ schemaVersion: 9, providers: {} }) })), emptyCatalogue())
  assert.deepEqual(loadCatalogue(undefined), emptyCatalogue())
  assert.deepEqual(loadCatalogue({ getItem() { throw new Error('denied') } }), emptyCatalogue())
})

test('nothing is pre-filled and legacy quota state yields no provider', () => {
  const storage = memoryStorage({ 'kairos-ai-quota-router:state': JSON.stringify(LEGACY_STATE) })
  assert.deepEqual(Object.keys(loadCatalogue(storage).providers), [])
})

test('providers, tombstones and order round-trip', () => {
  const cat = sampleCatalogue()
  cat.providers[MONTHLY_ID] = toTombstone(sampleMonthly(), '2026-03-05T00:00:00.000Z')
  cat.order = [PAYG_ID, WEEKLY_ID]
  const storage = memoryStorage()
  assert.equal(saveCatalogue(storage, cat), true)
  const loaded = loadCatalogue(storage)
  assert.deepEqual(loaded.providers, cat.providers)
  assert.deepEqual(loaded.order, cat.order)
  assert.deepEqual(loaded.recordIndex, {})
  assert.deepEqual(loaded.invalid, [])
})

test('invalid entries are dropped on load, valid ones kept', () => {
  const cat = sampleCatalogue()
  const raw = JSON.parse(JSON.stringify({ schemaVersion: 1, providers: cat.providers, order: cat.order }))
  raw.providers[WEEKLY_ID].name = ''
  const loaded = loadCatalogue(memoryStorage({ [PROVIDERS_STORAGE_KEY]: JSON.stringify(raw) }))
  assert.deepEqual(Object.keys(loaded.providers).sort(), [MONTHLY_ID, PAYG_ID].sort())
  assert.deepEqual(loaded.order, [MONTHLY_ID, PAYG_ID])
})

test('a failing storage makes save return false instead of throwing', () => {
  assert.equal(saveCatalogue({ setItem() { throw new Error('quota') } }, sampleCatalogue()), false)
  assert.equal(saveCatalogue(undefined, sampleCatalogue()), false)
})

test('saving touches only its own key', () => {
  const storage = memoryStorage({ 'kairos-ai-quota-router:state': 'S', 'kairos:weekly-history': 'H' })
  saveCatalogue(storage, sampleCatalogue())
  assert.equal(storage.getItem('kairos-ai-quota-router:state'), 'S')
  assert.equal(storage.getItem('kairos:weekly-history'), 'H')
  assert.deepEqual([...storage.data.keys()].sort(), ['kairos-ai-quota-router:state', 'kairos:weekly-history', PROVIDERS_STORAGE_KEY].sort())
})
