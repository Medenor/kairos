import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'

const NOW = new Date('2026-03-04T10:00:00.000Z')

function refused(input, catalogue = emptyCatalogue(), state = { keep: { me: 1 } }) {
  const result = addProvider({ catalogue, state, input, now: NOW, newId: sequentialIds() })
  assert.equal(result.ok, false)
  assert.equal(result.catalogue, catalogue, 'same catalogue reference')
  assert.equal(result.state, state, 'same state reference')
  return result.errors.map((e) => e.path)
}

const quota = (patch) => ({ label: 'Q', type: 'consumed_pct', value: 10, ...patch })

test('empty name', () => assert.deepEqual(refused(sampleInput({ name: '' })), ['name']))

test('a name equal to an existing one ignoring case and spaces', () => {
  const first = addProvider({ catalogue: emptyCatalogue(), state: {}, input: sampleInput({ name: 'claude' }), now: NOW, newId: sequentialIds() })
  assert.deepEqual(refused(sampleInput({ name: ' Claude ' }), first.catalogue), ['name'])
})

test('no quota and nine quotas', () => {
  assert.deepEqual(refused(sampleInput({ quotas: [], surplus: null })), ['quotas'])
  assert.deepEqual(refused(sampleInput({ quotas: Array.from({ length: 9 }, (_, i) => quota({ label: `Q${i}` })), surplus: null })), ['quotas'])
})

test('percentage values 140, -1, NaN and "abc"', () => {
  for (const value of [140, -1, NaN, 'abc']) {
    assert.deepEqual(refused(sampleInput({ quotas: [quota({ value })], surplus: null })), ['quotas[0].value'], String(value))
  }
})

test('a missing value is refused too', () => {
  assert.deepEqual(refused(sampleInput({ quotas: [quota({ value: undefined })], surplus: null })), ['quotas[0].value'])
})

test('a negative currency balance', () => {
  const q = { label: 'Bal', type: 'currency', currency: '$', value: -3 }
  assert.deepEqual(refused(sampleInput({ quotas: [q], schedule: { type: 'none' }, surplus: null })), ['quotas[0].value'])
})

test('custom cycle 0 and 400', () => {
  for (const cycleDays of [0, 400]) {
    assert.deepEqual(refused(sampleInput({ schedule: { type: 'custom', cycleDays }, surplus: null })), ['schedule.cycleDays'])
  }
})

test('negative cost and invalid colour', () => {
  assert.deepEqual(refused(sampleInput({ cost: { amount: -5, currency: '€' } })), ['cost.amount'])
  assert.deepEqual(refused(sampleInput({ color: 'red' })), ['color'])
})

test('several faults are all reported with their own path', () => {
  assert.deepEqual(refused(sampleInput({ name: '', color: 'red', quotas: [quota({ value: 200 })], surplus: null })).sort(), ['color', 'name', 'quotas[0].value'])
})
