import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy, defaultProviderSurplus, mergePolicyAfterConflict, migratePolicy, pruneProvider, setProviderSurplus, validatePolicy } from './policy.js'
import { LEGACY_POLICY_V1 } from '../providers/fixtures/legacyData.js'

const PA = 'p_policyaaaaaa'
const PB = 'p_policybbbbbb'

test('defaultPolicy() is schemaVersion 2 with an empty providers map', () => {
  const p = defaultPolicy()
  assert.equal(p.schemaVersion, 2)
  assert.deepEqual(p.providers, {})
})

test('validatePolicy accepts per-provider entries under the existing field rules and rejects other keys', () => {
  const p = defaultPolicy()
  p.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true, reservePct: 90, windowDays: 6 }
  assert.deepEqual(validatePolicy(p), { ok: true, errors: [] })
  p.providers[PA].surplusEnabled = 'yes'
  assert.equal(validatePolicy(p).ok, false)
  const keyed = defaultPolicy()
  keyed.providers.claude = defaultProviderSurplus()
  assert.deepEqual(validatePolicy(keyed).errors.map((e) => e.path), ['providers.claude'])
})

test('automatic runs need protected hours and acknowledged disclosures per provider', () => {
  const p = defaultPolicy()
  p.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true, autoRunEnabled: true }
  assert.equal(validatePolicy(p).ok, false)
  p.protectedHours = [{ days: [1], start: '22:00', end: '07:00' }]
  assert.equal(validatePolicy(p).ok, false, 'still no acknowledgement')
  p.providers[PA].disclosuresAckAt = '2026-11-03T10:00:00.000Z'
  assert.equal(validatePolicy(p).ok, true)
})

test('migratePolicy keeps the global fields, empties providers and moves the v1 services verbatim into legacy', () => {
  const frozen = structuredClone(LEGACY_POLICY_V1)
  const out = migratePolicy(LEGACY_POLICY_V1)
  assert.equal(out.schemaVersion, 2)
  assert.deepEqual(out.protectedHours, LEGACY_POLICY_V1.protectedHours)
  assert.deepEqual(out.costPct, LEGACY_POLICY_V1.costPct)
  assert.deepEqual(out.thresholds, LEGACY_POLICY_V1.thresholds)
  assert.equal(out.projectsBaseFolder, LEGACY_POLICY_V1.projectsBaseFolder)
  assert.deepEqual(out.providers, {})
  assert.deepEqual(out.legacy, LEGACY_POLICY_V1.services)
  assert.equal(JSON.stringify(out.legacy), JSON.stringify(LEGACY_POLICY_V1.services), 'byte-equal')
  assert.deepEqual(validatePolicy(out), { ok: true, errors: [] })
  assert.deepEqual(LEGACY_POLICY_V1, frozen, 'input untouched')
})

test('legacy settings are never applied: no provider entry comes out of a v1 policy', () => {
  const v1 = structuredClone(LEGACY_POLICY_V1)
  v1.services.claude.surplusEnabled = true
  const out = migratePolicy(v1)
  assert.deepEqual(Object.keys(out.providers), [])
  assert.equal(out.legacy.claude.surplusEnabled, true)
})

test('migratePolicy leaves a v2 policy alone and turns garbage into the default', () => {
  const v2 = defaultPolicy()
  assert.equal(migratePolicy(v2), v2)
  assert.deepEqual(migratePolicy(null), defaultPolicy())
  assert.deepEqual(migratePolicy([1]), defaultPolicy())
  assert.deepEqual(migratePolicy(undefined), defaultPolicy())
})

test('setProviderSurplus creates the default entry on first use; turning it off also turns automatic runs off', () => {
  const on = setProviderSurplus(defaultPolicy(), PA, true)
  assert.deepEqual(on.providers[PA], { ...defaultProviderSurplus(), surplusEnabled: true })
  const auto = { ...on, protectedHours: [{ days: [1], start: '22:00', end: '07:00' }], providers: { [PA]: { ...on.providers[PA], autoRunEnabled: true, disclosuresAckAt: '2026-11-03T10:00:00.000Z' } } }
  assert.equal(validatePolicy(auto).ok, true)
  const off = setProviderSurplus(auto, PA, false)
  assert.equal(off.providers[PA].autoRunEnabled, false)
  assert.equal(validatePolicy(off).ok, true)
})

test('pruneProvider removes the entry; a duplicate has no entry so everything starts off and disclosures need acknowledging again', () => {
  let p = setProviderSurplus(defaultPolicy(), PA, true)
  p = setProviderSurplus(p, PB, true)
  const pruned = pruneProvider(p, PA)
  assert.deepEqual(Object.keys(pruned.providers), [PB])
  assert.equal(pruneProvider(pruned, PA), pruned, 'no-op when absent')
  assert.equal(pruned.providers[PA], undefined)
  const duplicateOf = (policy, id) => policy.providers[id] ?? null
  assert.equal(duplicateOf(p, 'p_duplicateaaaa'), null)
})

test('mergePolicyAfterConflict keeps the other device\'s provider entries and my own settings (review finding)', () => {
  const server = defaultPolicy()
  server.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true, reservePct: 40 }
  const local = defaultPolicy()
  local.providers[PB] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const merged = mergePolicyAfterConflict(local, server)
  assert.deepEqual(Object.keys(merged.providers).sort(), [PA, PB])
  assert.equal(merged.providers[PA].reservePct, 40)
  assert.equal(validatePolicy(merged).ok, true)
  assert.deepEqual(Object.keys(local.providers), [PB], 'the input is not mutated')
})

test('mergePolicyAfterConflict: my entry wins for a provider both sides hold; an invalid server copy is ignored', () => {
  const server = defaultPolicy()
  server.providers[PA] = { ...defaultProviderSurplus(), reservePct: 10 }
  const local = defaultPolicy()
  local.providers[PA] = { ...defaultProviderSurplus(), reservePct: 70 }
  assert.equal(mergePolicyAfterConflict(local, server).providers[PA].reservePct, 70)
  assert.equal(mergePolicyAfterConflict(local, { nonsense: true }), local)
})
