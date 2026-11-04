import test from 'node:test'
import assert from 'node:assert/strict'
import { draftFromProvider, draftToInput, emptyDraft, emptyQuotaDraft, errorMap } from './providerDraft.js'
import { addProvider } from '../providers/catalogue.js'
import { emptyCatalogue } from '../providers/records.js'
import { sequentialIds, sampleCatalogue, sampleState, sampleWeekly } from '../providers/fixtures/sampleProviders.js'

const NOW = new Date('2026-03-04T10:00:00.000Z')

test('an empty draft converts to an input the reducer refuses at the right fields', () => {
  const result = addProvider({ catalogue: emptyCatalogue(), state: {}, input: draftToInput(emptyDraft()), now: NOW, newId: sequentialIds() })
  assert.equal(result.ok, false)
  assert.deepEqual(Object.keys(errorMap(result.errors)).sort(), ['name', 'quotas[0].label', 'quotas[0].value'])
})

test('a typed draft converts and creates a provider; empty text is "not entered", not zero', () => {
  const draft = emptyDraft()
  Object.assign(draft, { name: ' Mine ', costAmount: '12.5', flags: 'a, b ,', fits: { coding_hard: 'strong', oneshot: '' } })
  draft.quotas = [emptyQuotaDraft({ label: 'Weekly', value: '0' })]
  const input = draftToInput(draft)
  assert.deepEqual(input.cost, { amount: 12.5, currency: '€' })
  assert.deepEqual(input.flags, ['a', 'b'])
  assert.deepEqual(input.fits, { coding_hard: 'strong' })
  assert.equal(input.quotas[0].value, 0)
  assert.equal(input.surplus, null)
  assert.equal(addProvider({ catalogue: emptyCatalogue(), state: {}, input, now: NOW, newId: sequentialIds() }).ok, true)
  draft.quotas[0].value = ''
  assert.equal(draftToInput(draft).quotas[0].value, undefined)
  draft.quotas[0].value = 'abc'
  assert.ok(Number.isNaN(draftToInput(draft).quotas[0].value))
})

test('custom schedule keeps the typed cycle; weekly drops it', () => {
  const draft = emptyDraft()
  draft.scheduleType = 'custom'
  draft.cycleDays = '10'
  assert.deepEqual(draftToInput(draft).schedule, { type: 'custom', cycleDays: 10 })
  draft.scheduleType = 'weekly'
  assert.deepEqual(draftToInput(draft).schedule, { type: 'weekly' })
})

test('draftFromProvider round-trips a stored provider back to an equivalent input', () => {
  const cat = sampleCatalogue()
  const provider = cat.providers[sampleWeekly().id]
  const input = draftToInput(draftFromProvider(provider, sampleState()))
  assert.equal(input.name, provider.name)
  assert.deepEqual(input.quotas.map((q) => q.value), [40, 20])
  assert.deepEqual(input.surplus, provider.surplus)
  assert.deepEqual(input.quotas.map((q) => q.id), provider.quotas.map((q) => q.id))
})

test('errorMap keeps the first message per path', () => {
  assert.deepEqual(errorMap([{ path: 'a', message: '1' }, { path: 'a', message: '2' }, { path: 'b', message: '3' }]), { a: '1', b: '3' })
})
