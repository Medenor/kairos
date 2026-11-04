import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy, validatePolicy } from './policy.js'
import { DEFAULTS, SUPPORTED_SERVICE_IDS } from './constants.js'

const night = { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }
const paths = (r) => r.errors.map((e) => e.path)

test('defaultPolicy matches the documented defaults and is valid', () => {
  const p = defaultPolicy()
  assert.deepEqual(Object.keys(p.services), [...SUPPORTED_SERVICE_IDS])
  assert.equal(p.services.claude.reservePct, DEFAULTS.RESERVE_PCT)
  assert.equal(p.services.claude.windowDays, DEFAULTS.WINDOW_DAYS)
  assert.equal(p.services.claude.surplusEnabled, false)
  assert.equal(p.services.claude.autoRunEnabled, false)
  assert.equal(p.services.claude.disclosuresAckAt, null)
  assert.deepEqual(p.costPct, { small: 3, medium: 8, large: 15 })
  assert.deepEqual(p.thresholds, {
    freshnessHours: 12, sessionMaxAgeHours: 5, sessionMinRoomPct: 30, maxRunMinutes: 60, evalIntervalMinutes: 15,
  })
  assert.deepEqual(p.protectedHours, [])
  assert.equal(p.projectsBaseFolder, null)
  assert.deepEqual(validatePolicy(p), { ok: true, errors: [] })
})

test('defaultPolicy returns a fresh object each call', () => {
  const a = defaultPolicy()
  a.services.claude.reservePct = 50
  assert.equal(defaultPolicy().services.claude.reservePct, 20)
})

test('rejects non-objects and wrong schemaVersion', () => {
  assert.equal(validatePolicy(null).ok, false)
  assert.equal(validatePolicy('x').ok, false)
  const p = defaultPolicy()
  p.schemaVersion = 2
  assert.deepEqual(paths(validatePolicy(p)), ['schemaVersion'])
})

test('reservePct must be 0 to 90', () => {
  for (const [v, ok] of [[0, true], [90, true], [-1, false], [91, false], ['20', false], [NaN, false]]) {
    const p = defaultPolicy()
    p.services.claude.reservePct = v
    assert.equal(validatePolicy(p).ok, ok, `reservePct ${v}`)
  }
})

test('windowDays must be an integer from 1 to 6', () => {
  for (const [v, ok] of [[1, true], [6, true], [0, false], [7, false], [1.5, false]]) {
    const p = defaultPolicy()
    p.services.chatgpt.windowDays = v
    assert.equal(validatePolicy(p).ok, ok, `windowDays ${v}`)
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

test('only supported services are accepted', () => {
  const p = defaultPolicy()
  p.services.copilot = { ...p.services.claude }
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.deepEqual(paths(r), ['services.copilot'])
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
  const p = defaultPolicy()
  p.services.claude.autoRunEnabled = true
  p.services.claude.disclosuresAckAt = '2026-11-03T10:00:00.000Z'
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.deepEqual(paths(r), ['services.claude.autoRunEnabled'])
  assert.match(r.errors[0].message, /protected hours/)
})

test('autoRunEnabled is rejected without disclosure acknowledgement (FR-012)', () => {
  const p = defaultPolicy()
  p.protectedHours = [night]
  p.services.claude.autoRunEnabled = true
  const r = validatePolicy(p)
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /disclosures/)
})

test('autoRunEnabled is accepted with protected hours and acknowledgement', () => {
  const p = defaultPolicy()
  p.protectedHours = [night]
  p.services.claude.autoRunEnabled = true
  p.services.claude.disclosuresAckAt = '2026-11-03T10:00:00.000Z'
  assert.equal(validatePolicy(p).ok, true)
})

test('disclosuresAckAt must be an ISO string or null', () => {
  const p = defaultPolicy()
  p.services.claude.disclosuresAckAt = 'yesterday'
  assert.deepEqual(paths(validatePolicy(p)), ['services.claude.disclosuresAckAt'])
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

import { setServiceSurplus, autoRunBlockedReason, globalSwitchState, shouldArmGlobalSwitch } from './policy.js'

test('setServiceSurplus off also turns automatic runs off and stays valid', () => {
  const p = defaultPolicy()
  p.protectedHours = [{ days: [1], start: '09:00', end: '12:00' }]
  p.services.claude = { ...p.services.claude, surplusEnabled: true, autoRunEnabled: true, disclosuresAckAt: '2026-11-03T10:00:00.000Z' }
  assert.equal(validatePolicy(p).ok, true)
  const off = setServiceSurplus(p, 'claude', false)
  assert.equal(off.services.claude.surplusEnabled, false)
  assert.equal(off.services.claude.autoRunEnabled, false)
  assert.equal(validatePolicy(off).ok, true)
  assert.equal(p.services.claude.autoRunEnabled, true)
  const on = setServiceSurplus(off, 'claude', true)
  assert.equal(on.services.claude.surplusEnabled, true)
  assert.equal(on.services.claude.autoRunEnabled, false)
  assert.equal(setServiceSurplus(p, 'nope', true), p)
})

test('autoRunBlockedReason names surplus-off, protected hours and shared mode', () => {
  const p = defaultPolicy()
  assert.match(autoRunBlockedReason(p, 'claude', true), /surplus use for this service/)
  p.services.claude.surplusEnabled = true
  assert.match(autoRunBlockedReason(p, 'claude', true), /protected hours/)
  assert.match(autoRunBlockedReason(p, 'claude', false), /Shared mode is off/)
  p.protectedHours = [{ days: [1], start: '09:00', end: '12:00' }]
  assert.equal(autoRunBlockedReason(p, 'claude', true), '')
})

test('globalSwitchState is stopped only for an explicit stop', () => {
  assert.equal(globalSwitchState(null), 'unset')
  assert.equal(globalSwitchState(undefined), 'unset')
  assert.equal(globalSwitchState({ autoRunEnabled: false }), 'stopped')
  assert.equal(globalSwitchState({ autoRunEnabled: true }), 'on')
})

test('enabling a service arms the global switch only when it was never set, never after a stop', () => {
  assert.equal(shouldArmGlobalSwitch(globalSwitchState(null)), true)
  assert.equal(shouldArmGlobalSwitch(globalSwitchState({ autoRunEnabled: false })), false)
  assert.equal(shouldArmGlobalSwitch(globalSwitchState({ autoRunEnabled: true })), false)
})
