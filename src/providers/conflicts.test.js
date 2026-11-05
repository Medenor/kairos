import test from 'node:test'
import assert from 'node:assert/strict'
import { describeConflict } from './conflicts.js'
import { sampleWeekly } from './fixtures/sampleProviders.js'

const edit = (patch) => ({ ...sampleWeekly(), ...patch })

test('identical providers, or ones differing only by timestamps, have no difference', () => {
  assert.deepEqual(describeConflict(sampleWeekly(), sampleWeekly()), [])
  assert.deepEqual(describeConflict(sampleWeekly(), edit({ updatedAt: '2030-01-01T00:00:00.000Z' })), [])
})

test('every changed field is listed with both sides', () => {
  const changes = describeConflict(
    edit({ name: 'Mine', cost: { amount: 25, currency: '$' }, schedule: { type: 'custom', cycleDays: 10 }, fits: { oneshot: 'weak' } }),
    sampleWeekly(),
  )
  assert.deepEqual(changes.map((c) => c.field), ['Name', 'Cost', 'Reset schedule', 'Fit per task'])
  assert.deepEqual(changes[0], { field: 'Name', mine: 'Mine', theirs: 'Alpha Weekly' })
  assert.equal(changes[1].mine, '25$')
  assert.equal(changes[1].theirs, '20€')
  assert.equal(changes[2].mine, 'every 10 days')
})

test('quotas, flags, note, colour and surplus are compared by content, not by quota ids', () => {
  const base = sampleWeekly()
  const renamedIds = edit({ quotas: base.quotas.map((q, i) => ({ ...q, id: `q_other00${i}` })) })
  assert.deepEqual(describeConflict(renamedIds, base), [])
  const changed = describeConflict(
    edit({ quotas: [base.quotas[0]], flags: ['x'], note: 'n', color: '#000000', surplus: null }),
    base,
  )
  assert.deepEqual(changed.map((c) => c.field), ['Colour', 'Flags', 'Note', 'Quotas', 'Surplus use'])
  assert.equal(changed.find((c) => c.field === 'Quotas').mine, 'Weekly quota')
  assert.equal(changed.find((c) => c.field === 'Surplus use').theirs, 'claude tool')
})

test('missing sides give no difference and nothing is mutated', () => {
  assert.deepEqual(describeConflict(null, sampleWeekly()), [])
  const a = sampleWeekly()
  const b = edit({ name: 'x' })
  const frozen = JSON.stringify([a, b])
  describeConflict(a, b)
  assert.equal(JSON.stringify([a, b]), frozen)
})
