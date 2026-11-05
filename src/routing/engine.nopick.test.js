import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { NOW, quota, service, stateFor } from './routing.testkit.js'

const run = (services, values, task = 'coding_hard') => recommend({ task, providers: services, state: stateFor(services, values), now: NOW })

test('no provider: the reason says to add one', () => {
  const result = recommend({ task: 'coding_hard', providers: [], state: {}, now: NOW })
  assert.equal(result.primary, null)
  assert.deepEqual(result.alternatives, [])
  assert.match(result.reason, /No provider declared: add one/)
  assert.equal(result.tieBreak, null)
})

test('providers exist but none is suited to the task', () => {
  const a = service('a', { fits: { oneshot: 'strong' } })
  const result = run([a], { a: { a_q: 10 } })
  assert.equal(result.primary, null)
  assert.match(result.reason, /No provider is suited to "Heavy coding"/)
  assert.equal(result.excluded[0].cause, 'not_suitable')
})

test('all suited providers blocked: says so and names the soonest known reset', () => {
  const a = service('a', { name: 'Alpha', fits: { coding_hard: 'strong' } })
  const b = service('b', { name: 'Beta', fits: { coding_hard: 'strong' } })
  const result = run([a, b], { a: { a_q: 100, reset: 4 }, b: { b_q: 100, reset: 2 } })
  assert.equal(result.primary, null)
  assert.match(result.reason, /blocked or has no reading yet/)
  assert.match(result.reason, /Soonest reset: Beta in 2d/)
})

test('a blocked provider due today is reported as today; unknown resets add no reset sentence', () => {
  const a = service('a', { name: 'Alpha', fits: { coding_hard: 'strong' } })
  assert.match(run([a], { a: { a_q: 100, reset: 0 } }).reason, /Soonest reset: Alpha today/)
  assert.doesNotMatch(run([a], { a: { a_q: 100 } }).reason, /Soonest reset/)
})

test('all suited providers unread: same family of message', () => {
  const a = service('a', { fits: { coding_hard: 'strong' } })
  const result = run([a], { a: {} })
  assert.equal(result.primary, null)
  assert.match(result.reason, /blocked or has no reading yet/)
})

test('exactly one eligible provider: primary, no alternatives, no tie-break', () => {
  const a = service('a', { name: 'Alpha', fits: { coding_hard: 'strong' } })
  const b = service('b', { fits: {} })
  const result = run([a, b], { a: { a_q: 10 }, b: { b_q: 10 } })
  assert.equal(result.primary.providerId, 'a')
  assert.deepEqual(result.alternatives, [])
  assert.equal(result.tieBreak, null)
  assert.match(result.reason, /Only provider currently available/)
})

test('exactly one provider and it is blocked: nothing available', () => {
  const a = service('a', { fits: { coding_hard: 'strong' }, quotas: [quota('x', { label: 'Weekly' })] })
  const result = run([a], { a: { x: 100 } })
  assert.equal(result.primary, null)
  assert.equal(result.excluded.length, 1)
})
