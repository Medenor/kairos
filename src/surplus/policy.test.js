import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoRunBlockedReason, defaultPolicy, defaultProviderSurplus, globalSwitchState, setProviderSurplus, shouldArmGlobalSwitch, validatePolicy } from './policy.js'
import { DEFAULTS } from './constants.js'

const PA = 'p_claudeaaaaaa'
const PB = 'p_chatgptaaaaa'
// A policy with one configured provider (entries are created on first use, never pre-filled).
function withProvider(patch = {}) {
  const p = defaultPolicy()
  p.providers[PA] = { ...defaultProviderSurplus(), ...patch }
  return p
}

const night = { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }
const paths = (r) => r.errors.map((e) => e.path)

test('defaultPolicy matches the documented defaults, has no pre-filled provider and is valid', () => {
  const p = defaultPolicy()
  assert.equal(p.schemaVersion, 2)
  assert.deepEqual(p.providers, {})
  assert.deepEqual(defaultProviderSurplus(), {
    surplusEnabled: false, reservePct: DEFAULTS.RESERVE_PCT, windowDays: DEFAULTS.WINDOW_DAYS, autoRunEnabled: false, disclosuresAckAt: null,
  })
  assert.deepEqual(p.costPct, { small: 3, medium: 8, large: 15 })
  assert.deepEqual(p.thresholds, {
    freshnessHours: 12, sessionMaxAgeHours: 5, sessionMinRoomPct: 30, maxRunMinutes: 60, evalIntervalMinutes: 15,
  })
  assert.deepEqual(p.protectedHours, [])
  assert.equal(p.projectsBaseFolder, null)
  assert.deepEqual(validatePolicy(p), { ok: true, errors: [] })
})

test('defaultPolicy returns a fresh object each call', () => {
  const a = withProvider()
  a.providers[PA].reservePct = 50
  assert.equal(defaultProviderSurplus().reservePct, 20)
  assert.deepEqual(defaultPolicy().providers, {})
})

test('rejects non-objects and wrong schemaVersion', () => {
  assert.equal(validatePolicy(null).ok, false)
  assert.equal(validatePolicy('x').ok, false)
  const p = defaultPolicy()
  p.schemaVersion = 1
  assert.deepEqual(paths(validatePolicy(p)), ['schemaVersion'])
})

test('reservePct must be 0 to 90', () => {
  for (const [v, ok] of [[0, true], [90, true], [-1, false], [91, false], ['20', false], [NaN, false]]) {
    assert.equal(validatePolicy(withProvider({ reservePct: v })).ok, ok, `reservePct ${v}`)
  }
})

test('windowDays must be an integer from 1 to 6', () => {
  for (const [v, ok] of [[1, true], [6, true], [0, false], [7, false], [1.5, false]]) {
    assert.equal(validatePolicy(withProvider({ windowDays: v })).ok, ok, `windowDays ${v}`)
  }
})

test('costPct must be positive and ordered small <= medium <= large', () => {
  const p = defaultPolicy()
  p.costPct = { small: 5, medium: 5, large: 5 }
  assert.equal(validatePolicy(p).ok, true)
  p.costPct = { small: 9, medium: 8, large: 15 }
  assert.deepEqual(paths(validatePolicy(p)), ['costPct'])
  p.costPct = { small: 0, medium: 8, large: 15 }
  assert.deepEqual(paths(validatePolicy(p)), ['costPct.small'])
  p.costPct = { small: 3, medium: -1, large: 15 }
  assert.deepEqual(paths(validatePolicy(p)), ['costPct.medium'])
})

test('per-provider keys must be provider ids', () => {
  const p = defaultPolicy()
  p.providers.copilot = defaultProviderSurplus()
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.deepEqual(paths(r), ['providers.copilot'])
})

test('thresholds must be positive numbers', () => {
  const p = defaultPolicy()
  p.thresholds.maxRunMinutes = 0
  assert.deepEqual(paths(validatePolicy(p)), ['thresholds.maxRunMinutes'])
})

test('protected hours format is validated', () => {
  const bad = [
    { days: [], start: '22:00', end: '07:00' },
    { days: [7], start: '22:00', end: '07:00' },
    { days: [1, 1], start: '22:00', end: '07:00' },
    { days: [1], start: '24:00', end: '07:00' },
    { days: [1], start: '9:00', end: '07:00' },
    { days: [1], start: '22:00', end: '22:00' },
    { days: [1], start: '22:00' },
    'nope',
  ]
  for (const range of bad) {
    const p = defaultPolicy()
    p.protectedHours = [range]
    assert.equal(validatePolicy(p).ok, false, JSON.stringify(range))
  }
  const p = defaultPolicy()
  p.protectedHours = [night, { days: [1, 2], start: '09:00', end: '12:00' }]
  assert.equal(validatePolicy(p).ok, true)
})

test('autoRunEnabled is rejected without protected hours (FR-005)', () => {
  const p = withProvider({ autoRunEnabled: true, disclosuresAckAt: '2026-11-03T10:00:00.000Z' })
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.deepEqual(paths(r), [`providers.${PA}.autoRunEnabled`])
  assert.match(r.errors[0].message, /protected hours/)
})

test('autoRunEnabled is rejected without disclosure acknowledgement (FR-012)', () => {
  const p = withProvider({ autoRunEnabled: true })
  p.protectedHours = [night]
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /disclosures/)
})

test('autoRunEnabled is accepted with protected hours and acknowledgement', () => {
  const p = withProvider({ autoRunEnabled: true, disclosuresAckAt: '2026-11-03T10:00:00.000Z' })
  p.protectedHours = [night]
  assert.equal(validatePolicy(p).ok, true)
})

test('disclosuresAckAt must be an ISO string or null', () => {
  const p = withProvider({ disclosuresAckAt: 'yesterday' })
  assert.deepEqual(paths(validatePolicy(p)), [`providers.${PA}.disclosuresAckAt`])
})

test('projectsBaseFolder must be a string or null', () => {
  const p = defaultPolicy()
  p.projectsBaseFolder = '/Users/me/projects'
  assert.equal(validatePolicy(p).ok, true)
  p.projectsBaseFolder = 42
  assert.deepEqual(paths(validatePolicy(p)), ['projectsBaseFolder'])
})

test('validatePolicy does not mutate its input', () => {
  const p = defaultPolicy()
  const copy = structuredClone(p)
  validatePolicy(p)
  assert.deepEqual(p, copy)
})

test('setProviderSurplus creates the default entry on first use; off also turns automatic runs off and stays valid', () => {
  const p = withProvider({ surplusEnabled: true, autoRunEnabled: true, disclosuresAckAt: '2026-11-03T10:00:00.000Z' })
  p.protectedHours = [{ days: [1], start: '09:00', end: '12:00' }]
  assert.equal(validatePolicy(p).ok, true)
  const off = setProviderSurplus(p, PA, false)
  assert.equal(off.providers[PA].surplusEnabled, false)
  assert.equal(off.providers[PA].autoRunEnabled, false)
  assert.equal(validatePolicy(off).ok, true)
  assert.equal(p.providers[PA].autoRunEnabled, true, 'input not mutated')
  const on = setProviderSurplus(off, PA, true)
  assert.equal(on.providers[PA].surplusEnabled, true)
  assert.equal(on.providers[PA].autoRunEnabled, false)

  const first = setProviderSurplus(defaultPolicy(), PB, true)
  assert.deepEqual(first.providers[PB], { ...defaultProviderSurplus(), surplusEnabled: true })
  assert.equal(setProviderSurplus(p, 'nope', true), p, 'only provider ids get an entry')
})

test('autoRunBlockedReason names surplus-off, protected hours and shared mode', () => {
  const p = defaultPolicy()
  assert.match(autoRunBlockedReason(p, PA, true), /surplus use for this provider/)
  p.providers[PA] = { ...defaultProviderSurplus(), surplusEnabled: true }
  assert.match(autoRunBlockedReason(p, PA, true), /protected hours/)
  assert.match(autoRunBlockedReason(p, PA, false), /Shared mode is off/)
  p.protectedHours = [{ days: [1], start: '09:00', end: '12:00' }]
  assert.equal(autoRunBlockedReason(p, PA, true), '')
})

test('globalSwitchState is stopped only for an explicit stop', () => {
  assert.equal(globalSwitchState(null), 'unset')
  assert.equal(globalSwitchState(undefined), 'unset')
  assert.equal(globalSwitchState({ autoRunEnabled: false }), 'stopped')
  assert.equal(globalSwitchState({ autoRunEnabled: true }), 'on')
})

test('enabling a provider arms the global switch only when it was never set, never after a stop', () => {
  assert.equal(shouldArmGlobalSwitch(globalSwitchState(null)), true)
  assert.equal(shouldArmGlobalSwitch(globalSwitchState({ autoRunEnabled: false })), false)
  assert.equal(shouldArmGlobalSwitch(globalSwitchState({ autoRunEnabled: true })), false)
})
