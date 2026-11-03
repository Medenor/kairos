import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaseAgeSeconds, formatAge, describeLease, isApprovedOnRunner } from './runnerState.js'

const now = new Date('2026-11-03T12:00:00.000Z')
const lease = (over = {}) => ({
  designatedDeviceId: 'd1',
  designatedDeviceName: 'Studio Mac',
  designatedAt: '2026-11-01T08:00:00.000Z',
  deviceId: 'd1',
  deviceName: 'Studio Mac',
  startedAt: '2026-11-03T09:00:00.000Z',
  heartbeatAt: '2026-11-03T11:59:00.000Z',
  leaseSeconds: 180,
  approved: { a: 2 },
  ...over,
})

test('leaseAgeSeconds is whole seconds, never negative, null when unreadable', () => {
  assert.equal(leaseAgeSeconds(lease(), now), 60)
  assert.equal(leaseAgeSeconds(lease({ heartbeatAt: '2026-11-03T12:05:00.000Z' }), now), 0)
  assert.equal(leaseAgeSeconds(lease({ heartbeatAt: 'nope' }), now), null)
  assert.equal(leaseAgeSeconds(null, now), null)
})

test('formatAge picks a readable unit', () => {
  assert.equal(formatAge(3), 'just now')
  assert.equal(formatAge(42), '42 s ago')
  assert.equal(formatAge(150), '2 min ago')
  assert.equal(formatAge(3 * 3600 + 5), '3 h ago')
  assert.equal(formatAge(3 * 86400), '3 d ago')
  assert.equal(formatAge(null), 'unknown')
})

test('describeLease reports device, age and online state', () => {
  const d = describeLease(lease(), now)
  assert.equal(d.deviceName, 'Studio Mac')
  assert.equal(d.online, true)
  assert.equal(d.ageLabel, '1 min ago')
  assert.match(d.summary, /Studio Mac, last heartbeat 1 min ago/)
})

test('describeLease flags an expired lease and keeps the designated name', () => {
  const d = describeLease(lease({ heartbeatAt: '2026-11-03T11:00:00.000Z', deviceName: 'Other' }), now)
  assert.equal(d.online, false)
  assert.equal(d.deviceName, 'Studio Mac')
  assert.match(d.summary, /offline/)
})

test('describeLease returns null without a lease and falls back on a missing name', () => {
  assert.equal(describeLease(null, now), null)
  assert.equal(describeLease(lease({ designatedDeviceName: '  ', deviceName: '' }), now).deviceName, 'unnamed device')
})

test('isApprovedOnRunner matches the exact contentVersion only', () => {
  assert.equal(isApprovedOnRunner(lease(), { id: 'a', contentVersion: 2 }), true)
  assert.equal(isApprovedOnRunner(lease(), { id: 'a', contentVersion: 3 }), false)
  assert.equal(isApprovedOnRunner(lease(), { id: 'b', contentVersion: 2 }), false)
  assert.equal(isApprovedOnRunner(null, { id: 'a', contentVersion: 2 }), false)
  assert.equal(isApprovedOnRunner(lease(), { id: 'a' }), false)
})
