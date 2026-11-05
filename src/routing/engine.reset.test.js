import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { NOW, quota, service, stateFor } from './routing.testkit.js'

const TASK = 'coding_hard'
const mk = (id, extra = {}) => service(id, { name: id, fits: { [TASK]: 'strong' }, quotas: [quota(`${id}_q`)], ...extra })
const pick = (providers, values) => recommend({ task: TASK, providers, state: stateFor(providers, values), now: NOW })

test('equal providers with comparable pressure: the sooner reset is primary and the reason says so (FR-015)', () => {
  const a = mk('a')
  const b = mk('b')
  const result = pick([a, b], { a: { a_q: 31, reset: 5 }, b: { b_q: 44, reset: 2 } })
  assert.equal(result.primary.providerId, 'b')
  assert.equal(result.tieBreak.criterion, 'reset')
  assert.match(result.reason, /resets sooner than a \(2d vs 5d\)/)
})

test('pressures 14 and 16 fall in different buckets (documented difference D7)', () => {
  const a = mk('a')
  const b = mk('b')
  const result = pick([a, b], { a: { a_q: 16, reset: 1 }, b: { b_q: 14, reset: 6 } })
  assert.equal(result.primary.providerId, 'b')
  assert.equal(result.tieBreak.criterion, 'pressure_bucket')
  const sameBucket = pick([a, b], { a: { a_q: 16, reset: 1 }, b: { b_q: 15, reset: 6 } })
  assert.equal(sameBucket.primary.providerId, 'a', '15 and 16 share bucket 1: reset decides')
})

test('overdue, unset, invalid and none sort after every known reset', () => {
  const known = mk('known')
  for (const [label, extra, values] of [
    ['overdue', {}, { reset: -2 }],
    ['unset', {}, {}],
    ['none', { resetType: 'none', resetCycleDays: null }, {}],
  ]) {
    const other = mk('aaa', extra) // wins on name if resets were ignored
    const result = pick([other, known], { aaa: { aaa_q: 30, ...values }, known: { known_q: 30, reset: 6 } })
    assert.equal(result.primary.providerId, 'known', label)
    assert.equal(result.tieBreak.criterion, 'reset', label)
  }
  const invalidState = stateFor([mk('aaa'), known], { aaa: { aaa_q: 30 }, known: { known_q: 30, reset: 6 } })
  invalidState.aaa.__last_reset_date = '2099-01-01'
  const invalid = recommend({ task: TASK, providers: [mk('aaa'), known], state: invalidState, now: NOW })
  assert.equal(invalid.primary.providerId, 'known')
})

test('a due or overdue reset is noted in the reason; an overdue provider is never the "sooner reset"', () => {
  const overdue = mk('aaa')
  const later = mk('bbb')
  const result = pick([overdue, later], { aaa: { aaa_q: 30, reset: -5 }, bbb: { bbb_q: 30, reset: 4 } })
  assert.equal(result.primary.providerId, 'bbb')
  const due = pick([mk('aaa')], { aaa: { aaa_q: 30, reset: 0 } })
  assert.match(due.reason, /Reset due today/)
  const od = pick([mk('aaa')], { aaa: { aaa_q: 30, reset: -5 } })
  assert.match(od.reason, /Reset overdue/)
  assert.equal(od.primary.resetState, 'overdue')
})

test('day counts do not depend on the machine time zone', () => {
  const previous = process.env.TZ
  try {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz
      const now = new Date(2026, 2, 4, 23, 59, 0)
      const a = mk('a')
      const state = stateFor([a], { a: { a_q: 30, reset: 3 } }, now)
      const result = recommend({ task: TASK, providers: [a], state, now })
      assert.equal(result.primary.daysToReset, 3, tz)
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
