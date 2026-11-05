import test from 'node:test'
import assert from 'node:assert/strict'
import { getBarColor, getConsumedPct, getServicePressure, getStatusBadge } from './utils.js'

const currency = (lowBalance) => ({ id: 'c', type: 'currency', ...(lowBalance === undefined ? {} : { lowBalance }) })

test('without lowBalance the currency bands equal the former fixed table', () => {
  for (const [value, pct] of [[-1, 100], [0, 100], [0.01, 85], [1.99, 85], [2, 60], [4.99, 60], [5, 20], [500, 20]]) {
    assert.equal(getConsumedPct(currency(), value), pct, `value ${value}`)
    assert.equal(getConsumedPct(currency(null), value), pct, `value ${value} (null)`)
  }
})

test('with lowBalance 20 the bands are < 8 -> 85, < 20 -> 60', () => {
  const q = currency(20)
  for (const [value, pct] of [[0, 100], [7.99, 85], [8, 60], [19.99, 60], [20, 20], [100, 20]]) {
    assert.equal(getConsumedPct(q, value), pct, `value ${value}`)
  }
})

test('percentage types, status badges and bar colours are unchanged', () => {
  assert.equal(getConsumedPct({ type: 'consumed_pct' }, 70), 70)
  assert.equal(getConsumedPct({ type: 'remaining_pct' }, 75), 25)
  assert.equal(getConsumedPct({ type: 'other' }, 75), 0)
  assert.deepEqual(getStatusBadge(49), { label: 'Available', level: 'ok' })
  assert.deepEqual(getStatusBadge(100), { label: 'Exhausted', level: 'off' })
  assert.equal(getBarColor(10), '#1D9E75')
  assert.equal(getBarColor(90), '#E24B4A')
})

test('getServicePressure ignores unread quotas instead of returning NaN', () => {
  const svc = { id: 'p', quotas: [{ id: 'a', type: 'consumed_pct' }, { id: 'b', type: 'consumed_pct' }] }
  assert.equal(getServicePressure(svc, { p: { a: 30 } }), 30)
  assert.equal(getServicePressure(svc, { p: { a: 30, b: null } }), 30)
  assert.equal(getServicePressure(svc, { p: { a: undefined, b: 55 } }), 55)
  assert.equal(getServicePressure(svc, { p: {} }), 0)
  assert.equal(getServicePressure(svc, {}), 0)
})

test('getServicePressure takes the highest consumed percentage over all three quota types', () => {
  const svc = { id: 'p', quotas: [{ id: 'a', type: 'consumed_pct' }, { id: 'b', type: 'remaining_pct' }, { id: 'c', type: 'currency', lowBalance: 10 }] }
  assert.equal(getServicePressure(svc, { p: { a: 10, b: 5, c: 3 } }), 95) // remaining 5 -> consumed 95; balance 3 < 4 -> 85
  assert.equal(getServicePressure(svc, { p: { a: 10, b: 90, c: 3 } }), 85)
  assert.equal(getServicePressure(svc, { p: { a: 10, b: 90, c: 0 } }), 100)
})
