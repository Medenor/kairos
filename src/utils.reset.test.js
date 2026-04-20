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
