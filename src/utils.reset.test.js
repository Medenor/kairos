import test from 'node:test'
import assert from 'node:assert/strict'
import { getResetInfo } from './utils.js'

test('getResetInfo returns unset state when no last reset date is set', () => {
  const info = getResetInfo(null, 7, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'unset')
  assert.equal(info.daysRemaining, null)
})

test('getResetInfo returns countdown state for valid reset date', () => {
  const info = getResetInfo('2026-04-14', 7, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'countdown')
  assert.equal(info.daysRemaining, 1)
  assert.equal(info.nextResetDate, '2026-04-21')
})

test('getResetInfo returns due state on reset day', () => {
  const info = getResetInfo('2026-04-13', 7, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'due')
  assert.equal(info.daysRemaining, 0)
})

test('getResetInfo returns overdue state after reset day has passed', () => {
  const info = getResetInfo('2026-04-10', 7, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'overdue')
  assert.equal(info.daysRemaining, -3)
})

test('getResetInfo rejects future reset date', () => {
  const info = getResetInfo('2026-04-21', 7, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'invalid')
})

test('getResetInfo returns none state for services without scheduled reset', () => {
  const info = getResetInfo('2026-04-14', null, new Date('2026-04-20T10:00:00Z'))
  assert.equal(info.state, 'none')
  assert.equal(info.daysRemaining, null)
})

// ---------------------------------------------------------------------------
// 006 T005 — local calendar day basis near midnight (research D3)
// ---------------------------------------------------------------------------

function withTimeZone(tz, fn) {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

// Offset sanity: proves the zone really applies to Date in this process.
function assertZoneApplied(expectedOffsetMinutes) {
  assert.equal(
    new Date(2026, 3, 20, 12, 0).getTimezoneOffset(),
    expectedOffsetMinutes,
    'process.env.TZ must change the local zone used by Date'
  )
}

test('getResetInfo counts local calendar days in Pacific/Auckland (UTC+12) at 00:30 local', () => {
  withTimeZone('Pacific/Auckland', () => {
    assertZoneApplied(-720)
    const now = new Date(2026, 3, 21, 0, 30) // 2026-04-20T12:30Z: UTC day is still 04-20
    // Next reset 2026-04-21 is local today: due, not 1 day away.
    const due = getResetInfo('2026-04-14', 7, now)
    assert.equal(due.state, 'due')
    assert.equal(due.daysRemaining, 0)
    assert.equal(due.nextResetDate, '2026-04-21')
    // Next reset 2026-04-23 is two local days away (UTC basis says 3).
    const info = getResetInfo('2026-04-16', 7, now)
    assert.equal(info.state, 'countdown')
    assert.equal(info.daysRemaining, 2)
    assert.equal(info.nextResetDate, '2026-04-23')
    // A reset logged for local today is not in the future.
    assert.equal(getResetInfo('2026-04-21', 7, now).state, 'countdown')
  })
})

test('getResetInfo counts local calendar days in Pacific/Auckland at 23:30 local', () => {
  withTimeZone('Pacific/Auckland', () => {
    assertZoneApplied(-720)
    const now = new Date(2026, 3, 20, 23, 30) // 2026-04-20T11:30Z: UTC and local day agree
    assert.equal(getResetInfo('2026-04-14', 7, now).daysRemaining, 1)
    assert.equal(getResetInfo('2026-04-16', 7, now).daysRemaining, 3)
  })
})

test('getResetInfo counts local calendar days in America/Los_Angeles (UTC-7) at 23:30 local', () => {
  withTimeZone('America/Los_Angeles', () => {
    assertZoneApplied(420)
    const now = new Date(2026, 3, 20, 23, 30) // 2026-04-21T06:30Z: UTC day is already 04-21
    // Next reset 2026-04-21 is tomorrow locally (UTC basis says due today).
    const info = getResetInfo('2026-04-14', 7, now)
    assert.equal(info.state, 'countdown')
    assert.equal(info.daysRemaining, 1)
    assert.equal(info.nextResetDate, '2026-04-21')
    // Overdue count also follows the local day.
    const overdue = getResetInfo('2026-04-12', 7, now)
    assert.equal(overdue.state, 'overdue')
    assert.equal(overdue.daysRemaining, -1)
  })
})

test('getResetInfo counts local calendar days in America/Los_Angeles at 00:30 local', () => {
  withTimeZone('America/Los_Angeles', () => {
    assertZoneApplied(420)
    const now = new Date(2026, 3, 21, 0, 30) // 2026-04-21T07:30Z: UTC and local day agree
    assert.equal(getResetInfo('2026-04-14', 7, now).state, 'due')
    assert.equal(getResetInfo('2026-04-16', 7, now).daysRemaining, 2)
  })
})
