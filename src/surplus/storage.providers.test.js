import test from 'node:test'
import assert from 'node:assert/strict'
import { SURPLUS_STORAGE_KEYS, applySurplusRecords, emptySurplusState, loadCycles, loadIdeas, loadPolicy, loadRuns, savePolicy } from './storage.js'
import { defaultPolicy, validatePolicy } from './policy.js'
import { LEGACY_CYCLE, LEGACY_IDEA_LAUNCHED, LEGACY_POLICY_V1, LEGACY_RUN } from '../providers/fixtures/legacyData.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  }
}

test('a stored v1 policy loads as v2 with the global fields and the legacy section intact', () => {
  const storage = memoryStorage({ [SURPLUS_STORAGE_KEYS.policy]: JSON.stringify(LEGACY_POLICY_V1) })
  const policy = loadPolicy(storage)
  assert.equal(policy.schemaVersion, 2)
  assert.deepEqual(policy.providers, {})
  assert.deepEqual(policy.legacy, LEGACY_POLICY_V1.services)
  assert.deepEqual(policy.thresholds, LEGACY_POLICY_V1.thresholds)
  assert.deepEqual(validatePolicy(policy), { ok: true, errors: [] })
})

test('saving writes v2 and the legacy field stays byte-equal to the v1 services object', () => {
  const storage = memoryStorage({ [SURPLUS_STORAGE_KEYS.policy]: JSON.stringify(LEGACY_POLICY_V1) })
  const loaded = loadPolicy(storage)
  assert.equal(savePolicy(storage, loaded), true)
  const written = JSON.parse(storage.getItem(SURPLUS_STORAGE_KEYS.policy))
  assert.equal(written.schemaVersion, 2)
  assert.equal(JSON.stringify(written.legacy), JSON.stringify(LEGACY_POLICY_V1.services))
  assert.deepEqual(loadPolicy(storage), loaded, 'a second load changes nothing')
})

test('a corrupt policy still falls back to the default', () => {
  assert.deepEqual(loadPolicy(memoryStorage({ [SURPLUS_STORAGE_KEYS.policy]: '{nope' })), defaultPolicy())
})

test('applySurplusRecords keeps ignoring provider:* and catalogue-order records', () => {
  const items = [
    { record_type: 'routing_config', logical_key: 'provider:p_abcdefghijkl', payload: { status: 'active' }, version: 1, id: 'a' },
    { record_type: 'routing_config', logical_key: 'catalogue-order', payload: { ids: [] }, version: 1, id: 'b' },
  ]
  const base = emptySurplusState()
  const out = applySurplusRecords(base, items)
  assert.deepEqual(out.recordIndex, {})
  assert.deepEqual(out.invalid, [])
  assert.deepEqual(out.ideas, [])
})

test('a pulled v1 policy record is migrated, not rejected', () => {
  const item = { record_type: 'routing_config', logical_key: 'surplus-policy', payload: LEGACY_POLICY_V1, version: 2, id: 'p' }
  const out = applySurplusRecords(emptySurplusState(), [item])
  assert.equal(out.invalid.length, 0)
  assert.equal(out.policy.schemaVersion, 2)
  assert.deepEqual(out.policy.legacy, LEGACY_POLICY_V1.services)
})

test('a stored v1 idea, run and cycle load and are listed as valid', () => {
  const storage = memoryStorage({
    [SURPLUS_STORAGE_KEYS.ideas]: JSON.stringify([LEGACY_IDEA_LAUNCHED]),
    [SURPLUS_STORAGE_KEYS.runs]: JSON.stringify([LEGACY_RUN]),
    [SURPLUS_STORAGE_KEYS.cycles]: JSON.stringify([LEGACY_CYCLE]),
  })
  assert.deepEqual(loadIdeas(storage), [LEGACY_IDEA_LAUNCHED])
  assert.deepEqual(loadRuns(storage), [LEGACY_RUN])
  assert.deepEqual(loadCycles(storage), [LEGACY_CYCLE])
})
