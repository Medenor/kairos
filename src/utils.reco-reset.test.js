import test from 'node:test'
import assert from 'node:assert/strict'
import { getResetInfo, getResetSignals } from './utils.js'
import { recommend } from './routing/engine.js'
import { MONTHLY_ID, PAYG_ID, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleServices } from './providers/fixtures/sampleProviders.js'

// The rule assertions of the former fixed-provider table moved to src/routing (engine, reset, determinism
// and reference tests). What stays here: the reset arithmetic every path shares, per schedule kind.

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

test('weekly cycle (7 days): countdown, due today and overdue', () => {
  const now = new Date(2026, 3, 20, 12, 0)
  assert.deepEqual(
    ['2026-04-18', '2026-04-13', '2026-04-10'].map((d) => getResetInfo(d, 7, now).state),
    ['countdown', 'due', 'overdue']
  )
  assert.equal(getResetInfo('2026-04-18', 7, now).daysRemaining, 5)
  assert.equal(getResetInfo('2026-04-13', 7, now).daysRemaining, 0)
  assert.equal(getResetInfo('2026-04-10', 7, now).daysRemaining, -3)
})

test('monthly cycle (30 days): countdown, due today and overdue (FR-008)', () => {
  const now = new Date(2026, 3, 20, 12, 0)
  const countdown = getResetInfo('2026-04-05', 30, now)
  assert.equal(countdown.state, 'countdown')
  assert.equal(countdown.daysRemaining, 15)
  assert.equal(countdown.nextResetDate, '2026-05-05')
  assert.equal(getResetInfo('2026-03-21', 30, now).state, 'due')
  const overdue = getResetInfo('2026-03-10', 30, now)
  assert.equal(overdue.state, 'overdue')
  assert.equal(overdue.daysRemaining, -11)
})

test('custom cycle (10 days): countdown, due today and overdue (FR-008)', () => {
  const now = new Date(2026, 3, 20, 12, 0)
  assert.equal(getResetInfo('2026-04-15', 10, now).daysRemaining, 5)
  assert.equal(getResetInfo('2026-04-10', 10, now).state, 'due')
  assert.equal(getResetInfo('2026-04-01', 10, now).state, 'overdue')
  assert.equal(getResetInfo('2026-03-01', 10, now).daysRemaining, -40)
})

test('no schedule: never overdue, whatever the recorded date', () => {
  const now = new Date(2026, 3, 20, 12, 0)
  for (const date of [null, '2020-01-01', '2026-04-20']) {
    const info = getResetInfo(date, null, now)
    assert.equal(info.state, 'none')
    assert.equal(info.daysRemaining, null)
  }
})

test('unset and invalid dates are reported, a future last-reset date is invalid', () => {
  const now = new Date(2026, 3, 20, 12, 0)
  assert.equal(getResetInfo(null, 7, now).state, 'unset')
  assert.equal(getResetInfo('2026-02-31', 7, now).state, 'invalid')
  assert.equal(getResetInfo('2026-04-25', 7, now).label, 'Reset date cannot be in the future')
})

test('getResetSignals maps every provider through its own cycle and the shared now', () => {
  const services = sampleServices()
  const now = new Date(2026, 3, 20, 12, 0)
  const state = {
    [WEEKLY_ID]: { __last_reset_date: '2026-04-18' },
    [MONTHLY_ID]: { __last_reset_date: '2026-04-05' },
    [PAYG_ID]: { __last_reset_date: '2026-04-01' },
  }
  const signals = getResetSignals(state, services, now)
  assert.equal(signals[WEEKLY_ID].daysRemaining, 5)
  assert.equal(signals[MONTHLY_ID].daysRemaining, 15)
  assert.equal(signals[PAYG_ID].state, 'none')
})

test('006 D3 scenario: at 00:30 local (UTC+12) a reset on local day D+2 says "Resets in 2d" (UTC basis gave 3d)', () => {
  withTimeZone('Pacific/Auckland', () => {
    assert.equal(new Date(2026, 3, 21, 12, 0).getTimezoneOffset(), -720)
    const now = new Date(2026, 3, 21, 0, 30) // local 2026-04-21, UTC 2026-04-20T12:30Z
    const [weekly] = sampleServices()
    assert.equal(getResetInfo('2026-04-16', 7, now).daysRemaining, 2) // last reset 04-16 + 7d = 04-23 = local D+2
    const state = { [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 30, [WEEKLY_Q_SESSION]: 40, __last_reset_date: '2026-04-16' } }
    const result = recommend({ task: 'coding_hard', providers: [weekly], state, now })
    assert.equal(result.primary.providerId, WEEKLY_ID)
    assert.ok(
      result.reason.includes('Resets in 2d — spend it now before quota refreshes.'),
      `note must use the local day count (2d), not the UTC one (3d): "${result.reason}"`
    )
    assert.ok(!result.reason.includes('Resets in 3d'), `reason must not show the UTC-basis count: "${result.reason}"`)
  })
})

test('006 D3 scenario: the reset note at 23:30 local is unchanged', () => {
  withTimeZone('Pacific/Auckland', () => {
    const now = new Date(2026, 3, 20, 23, 30) // UTC day and local day agree
    const [weekly] = sampleServices()
    const state = { [WEEKLY_ID]: { [WEEKLY_Q_WEEK]: 30, [WEEKLY_Q_SESSION]: 40, __last_reset_date: '2026-04-15' } } // next reset 04-22 -> 2d
    const result = recommend({ task: 'coding_hard', providers: [weekly], state, now })
    assert.equal(result.primary.daysToReset, 2)
    assert.ok(result.reason.endsWith('Resets in 2d — spend it now before quota refreshes.'), result.reason)
  })
})
