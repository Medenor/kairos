import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_SERVICE_IDS,
  isKnownServiceRef,
  isLegacyServiceId,
  isProviderId,
  isQuotaId,
  newProviderId,
  newQuotaId,
} from './ids.js'

function seeded(seed = 7) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

test('newProviderId and newQuotaId follow the documented formats', () => {
  const random = seeded()
  for (let i = 0; i < 50; i += 1) {
    assert.match(newProviderId(random), /^p_[a-z2-7]{12}$/)
    assert.match(newQuotaId(random), /^q_[a-z2-7]{8}$/)
  }
})

test('ids are deterministic with an injected random source and differ between calls', () => {
  assert.equal(newProviderId(seeded(3)), newProviderId(seeded(3)))
  const random = seeded(3)
  assert.notEqual(newProviderId(random), newProviderId(random))
})

test('the default random source produces valid ids', () => {
  assert.ok(isProviderId(newProviderId()))
  assert.ok(isQuotaId(newQuotaId()))
})

test('isProviderId and isQuotaId accept and reject strings', () => {
  assert.equal(isProviderId('p_abcdefghijkl'), true)
  assert.equal(isProviderId('p_abcdefghij'), false)
  assert.equal(isProviderId('p_ABCDEFGHIJKL'), false)
  assert.equal(isProviderId('p_abcdefghij01'), false)
  assert.equal(isProviderId('claude'), false)
  assert.equal(isProviderId(null), false)
  assert.equal(isProviderId(12), false)
  assert.equal(isQuotaId('q_abcdefgh'), true)
  assert.equal(isQuotaId('q_abcdefg'), false)
  assert.equal(isQuotaId('weekly'), false)
})

test('legacy ids are exactly the five former ids and no generated id equals one', () => {
  assert.deepEqual([...LEGACY_SERVICE_IDS], ['claude', 'chatgpt', 'copilot', 'openrouter', 'kilocode'])
  assert.ok(Object.isFrozen(LEGACY_SERVICE_IDS))
  for (const id of LEGACY_SERVICE_IDS) assert.equal(isLegacyServiceId(id), true)
  assert.equal(isLegacyServiceId('Claude'), false)
  assert.equal(isLegacyServiceId('p_abcdefghijkl'), false)
  const random = seeded(11)
  for (let i = 0; i < 100; i += 1) assert.equal(isLegacyServiceId(newProviderId(random)), false)
})

test('isKnownServiceRef accepts provider ids and legacy ids only', () => {
  assert.equal(isKnownServiceRef('p_abcdefghijkl'), true)
  assert.equal(isKnownServiceRef('kilocode'), true)
  assert.equal(isKnownServiceRef('unknown'), false)
  assert.equal(isKnownServiceRef(undefined), false)
})
