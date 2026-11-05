import test from 'node:test'
import assert from 'node:assert/strict'
import { addProvider } from './catalogue.js'
import { emptyCatalogue } from './records.js'
import { isProviderId, isQuotaId } from './ids.js'
import { sampleInput, sequentialIds } from './fixtures/sampleProviders.js'
import { LEGACY_STATE } from './fixtures/legacyData.js'
import { applyProviderStateEffects } from '../stateTransitions.js'

const NOW = new Date('2026-03-04T10:00:00.000Z')
const add = (input, catalogue = emptyCatalogue(), state = {}, newId = sequentialIds()) =>
  addProvider({ catalogue, state, input, now: NOW, newId })

test('creates the provider with timestamps, generated ids, active status and appends it to the order', () => {
  const result = add(sampleInput())
  assert.equal(result.ok, true)
  const [id] = Object.keys(result.catalogue.providers)
  const p = result.catalogue.providers[id]
  assert.ok(isProviderId(id))
  assert.equal(p.id, id)
  assert.equal(p.status, 'active')
  assert.equal(p.createdAt, NOW.toISOString())
  assert.equal(p.updatedAt, NOW.toISOString())
  assert.equal(p.name, 'Delta Weekly')
  assert.deepEqual(p.schedule, { type: 'weekly', cycleDays: 7 })
  assert.deepEqual(result.catalogue.order, [id])
  assert.ok(p.quotas.every((q) => isQuotaId(q.id)))
  assert.equal(new Set(p.quotas.map((q) => q.id)).size, 2)
  assert.equal(p.quotas[0].value, undefined, 'definitions hold no value')
})

test('surplus designations are remapped from refs to the generated quota ids', () => {
  const p = Object.values(add(sampleInput()).catalogue.providers)[0]
  assert.deepEqual(p.surplus, { tool: 'claude', weeklyQuotaId: p.quotas[0].id, sessionQuotaId: p.quotas[1].id })
  const none = Object.values(add(sampleInput({ surplus: null })).catalogue.providers)[0]
  assert.equal(none.surplus, null)
})

test('each entered value is written with its reading stamp and the reset date starts null (FR-039)', () => {
  const result = add(sampleInput())
  const [id] = Object.keys(result.catalogue.providers)
  const [q1, q2] = result.catalogue.providers[id].quotas
  assert.deepEqual(result.state[id], {
    [q1.id]: 30,
    [`__ts_${q1.id}`]: NOW.toISOString(),
    [q2.id]: 10,
    [`__ts_${q2.id}`]: NOW.toISOString(),
    __last_reset_date: null,
  })
  assert.deepEqual(result.effects.stateWrites.map((w) => w.logicalKey).sort(), [
    `${id}:${q1.id}`, `${id}:${q2.id}`, `${id}:__last_reset_date`, `${id}:__ts_${q1.id}`, `${id}:__ts_${q2.id}`,
  ].sort())
  assert.deepEqual(applyProviderStateEffects({}, result.effects), result.state)
})

test('entries of former ids already in state are left untouched', () => {
  const before = structuredClone(LEGACY_STATE)
  const result = add(sampleInput(), emptyCatalogue(), before)
  for (const [legacyId, entry] of Object.entries(LEGACY_STATE)) assert.deepEqual(result.state[legacyId], entry)
  assert.deepEqual(before, LEGACY_STATE)
})

test('two providers get distinct provider and quota ids; the inputs are not mutated', () => {
  const newId = sequentialIds()
  const first = add(sampleInput(), emptyCatalogue(), {}, newId)
  const frozen = JSON.stringify(first.catalogue)
  const second = add(sampleInput({ name: 'Other' }), first.catalogue, first.state, newId)
  assert.equal(JSON.stringify(first.catalogue), frozen)
  const [a, b] = Object.values(second.catalogue.providers)
  assert.notEqual(a.id, b.id)
  const quotaIds = [...a.quotas, ...b.quotas].map((q) => q.id)
  assert.equal(new Set(quotaIds).size, 4)
  assert.deepEqual(second.catalogue.order, [a.id, b.id])
})

test('a colliding generated id is skipped', () => {
  const ids = ['p_aaaaaaaaaaab', 'p_aaaaaaaaaaab', 'p_aaaaaaaaaaac']
  let q = 0
  const newId = (kind) => (kind === 'provider' ? ids.shift() : `q_aaaaaaa${'abcdefgh'[q++ % 8]}`)
  const first = add(sampleInput(), emptyCatalogue(), {}, newId)
  const second = add(sampleInput({ name: 'Other' }), first.catalogue, first.state, newId)
  assert.deepEqual(Object.keys(second.catalogue.providers), ['p_aaaaaaaaaaab', 'p_aaaaaaaaaaac'])
})

test('input is trimmed and defaulted: empty flags dropped, schedule normalised, null cost kept', () => {
  const result = add(sampleInput({ name: '  Spaced  ', flags: [' a ', ''], cost: null, schedule: { type: 'none' }, surplus: null, note: undefined }))
  const p = Object.values(result.catalogue.providers)[0]
  assert.equal(p.name, 'Spaced')
  assert.deepEqual(p.flags, ['a'])
  assert.equal(p.cost, null)
  assert.deepEqual(p.schedule, { type: 'none', cycleDays: null })
  assert.equal(p.note, '')
})

test('a currency quota keeps its symbol and low-balance level; a percentage quota has neither', () => {
  const result = add(sampleInput({
    schedule: { type: 'none' }, surplus: null,
    quotas: [{ label: 'Balance', type: 'currency', currency: '$', lowBalance: 20, value: 12.5 }, { label: 'Pct', type: 'consumed_pct', value: 5 }],
  }))
  const [bal, pct] = Object.values(result.catalogue.providers)[0].quotas
  assert.deepEqual([bal.currency, bal.lowBalance, pct.currency, pct.lowBalance], ['$', 20, null, null])
})
