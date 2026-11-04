import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveProviderName } from './names.js'
import { toTombstone } from './records.js'
import { MONTHLY_ID, WEEKLY_ID, sampleCatalogue, sampleMonthly } from './fixtures/sampleProviders.js'

test('a live provider resolves to its current name, ignoring any captured name', () => {
  assert.deepEqual(resolveProviderName(WEEKLY_ID, { catalogue: sampleCatalogue(), capturedName: 'Old name' }), {
    name: 'Alpha Weekly', removed: false, source: 'live',
  })
})

test('a captured name is used for a provider that is not live', () => {
  const cat = sampleCatalogue()
  cat.providers[MONTHLY_ID] = toTombstone(sampleMonthly(), '2026-03-05T00:00:00.000Z')
  assert.deepEqual(resolveProviderName(MONTHLY_ID, { catalogue: cat, capturedName: 'At the time' }), {
    name: 'At the time', removed: true, source: 'captured',
  })
})

test('a tombstone name is used when nothing was captured', () => {
  const cat = sampleCatalogue()
  cat.providers[MONTHLY_ID] = toTombstone(sampleMonthly(), '2026-03-05T00:00:00.000Z')
  assert.deepEqual(resolveProviderName(MONTHLY_ID, { catalogue: cat }), { name: 'Beta Monthly', removed: true, source: 'tombstone' })
})

test('the five former ids resolve through the display-only legacy table', () => {
  const expected = { claude: 'Claude', chatgpt: 'ChatGPT', copilot: 'GitHub Copilot', openrouter: 'OpenRouter', kilocode: 'Kilocode' }
  for (const [id, name] of Object.entries(expected)) {
    assert.deepEqual(resolveProviderName(id, { catalogue: sampleCatalogue() }), { name, removed: true, source: 'legacy' })
  }
})

test('an unknown id resolves to itself, marked removed', () => {
  assert.deepEqual(resolveProviderName('p_unknownzzzzz', {}), { name: 'p_unknownzzzzz', removed: true, source: 'unknown' })
  assert.deepEqual(resolveProviderName('toString', {}), { name: 'toString', removed: true, source: 'unknown' })
})
