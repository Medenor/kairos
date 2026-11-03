import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetDayStart, nextProtectedStart, isInProtectedHours, hardStopAt } from './time.js'

let savedTz
beforeEach(() => { savedTz = process.env.TZ; process.env.TZ = 'Europe/Paris' })
afterEach(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz })

// 2026-11-03 is a Tuesday (getDay() === 2)
const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m)
const night = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }]
const work = [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }]

test('resetDayStart returns local midnight of the date', () => {
  const d = resetDayStart('2026-11-10')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 10)
  assert.equal(d.getDate(), 10)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
})

test('resetDayStart returns null for absent or invalid dates', () => {
  assert.equal(resetDayStart(null), null)
  assert.equal(resetDayStart('nope'), null)
  assert.equal(resetDayStart('2026-02-31'), null)
})

test('isInProtectedHours handles same-day ranges and weekday lists', () => {
  assert.equal(isInProtectedHours(work, at(3, 10)), true) // Tuesday 10:00
  assert.equal(isInProtectedHours(work, at(3, 12)), false) // end is exclusive
  assert.equal(isInProtectedHours(work, at(7, 10)), false) // Saturday
  assert.equal(isInProtectedHours([], at(3, 10)), false)
})

test('isInProtectedHours handles ranges crossing midnight', () => {
  assert.equal(isInProtectedHours(night, at(3, 23)), true)
  assert.equal(isInProtectedHours(night, at(4, 6, 59)), true)
  assert.equal(isInProtectedHours(night, at(4, 7)), false)
  assert.equal(isInProtectedHours(night, at(3, 21, 59)), false)
})

test('a crossing range belongs to its start day', () => {
  const fri = [{ days: [5], start: '22:00', end: '07:00' }] // Friday night
  assert.equal(isInProtectedHours(fri, at(7, 3)), true) // Saturday 03:00
  assert.equal(isInProtectedHours(fri, at(6, 3)), false) // Friday 03:00 (Thursday night not listed)
})

test('nextProtectedStart returns null when nothing is declared', () => {
  assert.equal(nextProtectedStart([], at(3, 10)), null)
})

test('nextProtectedStart finds the next start later today, tomorrow or next week', () => {
  assert.deepEqual(nextProtectedStart(night, at(3, 10)), at(3, 22))
  assert.deepEqual(nextProtectedStart(work, at(3, 13)), at(4, 9))
  // Friday 13:00 -> Monday 09:00
  assert.deepEqual(nextProtectedStart(work, at(6, 13)), at(9, 9))
  // Same weekday, already past: next week
  const tue = [{ days: [2], start: '09:00', end: '10:00' }]
  assert.deepEqual(nextProtectedStart(tue, at(3, 11)), at(10, 9))
})

test('nextProtectedStart takes the earliest of several ranges', () => {
  const both = [...night, ...work]
  assert.deepEqual(nextProtectedStart(both, at(3, 8)), at(3, 9))
})

test('nextProtectedStart counts a start equal to now', () => {
  assert.deepEqual(nextProtectedStart(night, at(3, 22)), at(3, 22))
})

test('hardStopAt is now + maxRunMinutes when nothing else is closer', () => {
  const policy = { thresholds: { maxRunMinutes: 60 }, protectedHours: [] }
  assert.deepEqual(hardStopAt(at(3, 10), policy, '2026-11-10'), at(3, 11))
})

test('hardStopAt is capped by the next protected start', () => {
  const policy = { thresholds: { maxRunMinutes: 120 }, protectedHours: night }
  assert.deepEqual(hardStopAt(at(3, 21), policy, '2026-11-10'), at(3, 22))
})

test('hardStopAt is capped by the reset day start', () => {
  const policy = { thresholds: { maxRunMinutes: 120 }, protectedHours: [] }
  assert.deepEqual(hardStopAt(at(3, 23), policy, '2026-11-04'), at(4, 0))
})

test('hardStopAt returns now when already inside protected hours', () => {
  const policy = { thresholds: { maxRunMinutes: 60 }, protectedHours: night }
  assert.deepEqual(hardStopAt(at(3, 23), policy, '2026-11-10'), at(3, 23))
})

test('hardStopAt tolerates a missing reset date and falls back to default duration', () => {
  assert.deepEqual(hardStopAt(at(3, 10), { protectedHours: [] }, null), at(3, 11))
})

test('hardStopAt keeps elapsed real time across a DST change', () => {
  // Paris clocks go forward on 2026-03-29 at 02:00; 01:30 + 60 min is 03:30 local.
  const policy = { thresholds: { maxRunMinutes: 60 }, protectedHours: [] }
  const now = new Date(2026, 2, 29, 1, 30)
  assert.equal(hardStopAt(now, policy, null).getTime() - now.getTime(), 3600000)
})
