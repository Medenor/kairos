import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeProviders } from './summary.js'
import { MONTHLY_ID, PAYG_ID, WEEKLY_ID, WEEKLY_Q_SESSION, WEEKLY_Q_WEEK, sampleServices, sampleState } from './fixtures/sampleProviders.js'

test('costs are totalled per currency, never across currencies', () => {
  const services = sampleServices()
  services[1] = { ...services[1], cost: 10, costCurrency: '$' }
  const out = summarizeProviders(services, sampleState())
  assert.deepEqual(out.monthlyCosts, [{ currency: '$', total: 10 }, { currency: '€', total: 20 }])
  const same = summarizeProviders([services[0], { ...services[0], id: 'other', cost: 5.5 }], {})
  assert.deepEqual(same.monthlyCosts, [{ currency: '€', total: 25.5 }])
})

test('a provider with no cost contributes nothing', () => {
  const out = summarizeProviders(sampleServices().filter((s) => s.id === PAYG_ID), sampleState())
  assert.deepEqual(out.monthlyCosts, [])
  assert.equal(out.providerCount, 1)
})

test('providers under pressure are counted with getConsumedPct, unread quotas ignored', () => {
  const state = sampleState()
  assert.equal(summarizeProviders(sampleServices(), state).underPressure, 0)
  state[WEEKLY_ID][WEEKLY_Q_WEEK] = 80
  assert.equal(summarizeProviders(sampleServices(), state).underPressure, 1)
  state[MONTHLY_ID].q_monthly2 = 99
  state[PAYG_ID].q_balance2 = 0
  assert.equal(summarizeProviders(sampleServices(), state).underPressure, 3)
  const unread = { [WEEKLY_ID]: { [WEEKLY_Q_SESSION]: undefined } }
  assert.equal(summarizeProviders(sampleServices(), unread).underPressure, 0)
})

test('an empty list gives zero totals', () => {
  assert.deepEqual(summarizeProviders([], {}), { providerCount: 0, monthlyCosts: [], underPressure: 0 })
})
