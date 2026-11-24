import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { ROUTING_RULESET_VERSION } from './constants.js'
import { NOW, quota, service, stateFor } from './routing.testkit.js'

const run = (task, services, values) => recommend({ task, providers: services, state: stateFor(services, values), now: NOW })

test('ruleset version is 2', () => assert.equal(ROUTING_RULESET_VERSION, 2))

test('fit none or undeclared makes a provider not_suitable with the visible default', () => {
  const a = service('a', { fits: { coding_hard: 'strong' } })
  const b = service('b', { fits: { coding_hard: 'none' } })
  const c = service('c', { fits: {} })
  const result = run('coding_hard', [a, b, c], { a: { a_q: 10 }, b: { b_q: 10 }, c: { c_q: 10 } })
  assert.equal(result.primary.providerId, 'a')
  const byId = Object.fromEntries(result.excluded.map((e) => [e.providerId, e]))
  assert.equal(byId.b.cause, 'not_suitable')
  assert.match(byId.b.detail, /Declared as not suitable/)
  assert.equal(byId.c.cause, 'not_suitable')
  assert.match(byId.c.detail, /Not set: treated as not suitable/)
})

test('a gating quota at 100 % consumed, or a balance <= 0, blocks and names the quota', () => {
  const a = service('a', { fits: { oneshot: 'strong' }, quotas: [quota('x', { label: 'Weekly', gates: null })] })
  const b = service('b', { fits: { oneshot: 'strong' }, resetType: 'none', resetCycleDays: null, quotas: [quota('y', { type: 'currency', currency: '$', label: 'Balance' })] })
  const c = service('c', { fits: { oneshot: 'acceptable' } })
  const result = run('oneshot', [a, b, c], { a: { x: 100 }, b: { y: 0 }, c: { c_q: 10 } })
  assert.equal(result.primary.providerId, 'c')
  const byId = Object.fromEntries(result.excluded.map((e) => [e.providerId, e]))
  assert.equal(byId.a.cause, 'blocked')
  assert.match(byId.a.detail, /Weekly/)
  assert.equal(byId.b.cause, 'blocked')
  assert.match(byId.b.detail, /Balance/)
})

test('a remaining_pct quota at 0 blocks', () => {
  const a = service('a', { fits: { oneshot: 'strong' }, quotas: [quota('x', { type: 'remaining_pct', label: 'Left' })] })
  const result = run('oneshot', [a], { a: { x: 0 } })
  assert.equal(result.primary, null)
  assert.equal(result.excluded[0].cause, 'blocked')
})

test('a gating quota without a reading makes the provider unread, naming the quota', () => {
  const a = service('a', { fits: { oneshot: 'strong' }, quotas: [quota('x', { label: 'Weekly' })] })
  const result = run('oneshot', [a], { a: {} })
  assert.deepEqual(result.excluded.map((e) => [e.cause, e.detail]), [['unread', 'No reading yet for Weekly.']])
})

test('a quota that does not gate the task never blocks it', () => {
  const a = service('a', {
    fits: { coding_hard: 'strong', daily_chat: 'acceptable' },
    quotas: [quota('hard', { gates: ['coding_hard'], label: 'Heavy' }), quota('chat', { gates: ['daily_chat'], label: 'Chat' })],
  })
  const blockedForHard = run('coding_hard', [a], { a: { hard: 100, chat: 10 } })
  assert.equal(blockedForHard.primary, null)
  const stillChat = run('daily_chat', [a], { a: { hard: 100, chat: 10 } })
  assert.equal(stillChat.primary.providerId, 'a')
  assert.equal(stillChat.primary.gatingQuotaId, 'chat')
  assert.equal(stillChat.primary.pressure, 10)
  const unreadElsewhere = run('daily_chat', [a], { a: { chat: 10 } })
  assert.equal(unreadElsewhere.primary.providerId, 'a')
})

test('pressure is the highest consumed % over gating quotas, over all three quota types', () => {
  const a = service('a', {
    fits: { coding_hard: 'strong' },
    quotas: [quota('p', { type: 'consumed_pct' }), quota('r', { type: 'remaining_pct' }), quota('c', { type: 'currency', currency: '$', lowBalance: 10 })],
  })
  assert.equal(run('coding_hard', [a], { a: { p: 10, r: 90, c: 50 } }).primary.pressure, 20) // currency 50 >= low -> 20
  assert.equal(run('coding_hard', [a], { a: { p: 10, r: 5, c: 50 } }).primary.pressure, 95)
  assert.equal(run('coding_hard', [a], { a: { p: 10, r: 90, c: 3 } }).primary.pressure, 85)
  const picked = run('coding_hard', [a], { a: { p: 10, r: 5, c: 50 } }).primary
  assert.equal(picked.gatingQuotaId, 'r')
})

test('score = fit minus band penalty: strong at 70 % = 2, acceptable at 20 % = 2, weak at 90 % = -1', () => {
  const strong = service('s', { fits: { coding_hard: 'strong' } })
  const accept = service('a', { fits: { coding_hard: 'acceptable' } })
  const weak = service('w', { fits: { coding_hard: 'weak' } })
  const score = (svc, pct) => run('coding_hard', [svc], { [svc.id]: { [`${svc.id}_q`]: pct } }).primary.score
  assert.equal(score(strong, 70), 2)
  assert.equal(score(accept, 20), 2)
  assert.equal(score(weak, 90), -1)
  assert.equal(score(strong, 59), 3)
  assert.equal(score(strong, 60), 2)
  assert.equal(score(strong, 84), 2)
  assert.equal(score(strong, 85), 1)
  assert.equal(score(strong, 99), 1)
})

test('a strong-fit provider at 70 % loses to an acceptable one at 20 % (same score, lower bucket)', () => {
  const strong = service('s', { fits: { coding_hard: 'strong' }, resetCycleDays: null, resetType: 'none' })
  const accept = service('a', { fits: { coding_hard: 'acceptable' }, resetCycleDays: null, resetType: 'none' })
  const result = run('coding_hard', [strong, accept], { s: { s_q: 70 }, a: { a_q: 20 } })
  assert.equal(result.primary.providerId, 'a')
  assert.equal(result.alternatives[0].providerId, 's')
  assert.equal(result.tieBreak.criterion, 'pressure_bucket')
})

test('within the same score and pressure bucket the sooner reset wins, even if slightly more loaded', () => {
  const loaded = service('s', { fits: { coding_hard: 'strong' } })
  const light = service('a', { fits: { coding_hard: 'strong' } })
  // both strong, 40 % and 31 % fall in bucket 2: reset decides, not the lower pressure
  const result = run('coding_hard', [loaded, light], { s: { s_q: 40, reset: 1 }, a: { a_q: 31, reset: 6 } })
  assert.equal(result.primary.providerId, 's')
  assert.equal(result.tieBreak.criterion, 'reset')
  assert.match(result.reason, /resets sooner than a \(1d vs 6d\)/)
})

test('the reason states fit, pressure with the quota label, days to reset, the decisive criterion and a reset note', () => {
  const a = service('a', { name: 'Alpha', fits: { coding_hard: 'strong' }, quotas: [quota('x', { label: 'Weekly quota' })] })
  const b = service('b', { name: 'Beta', fits: { coding_hard: 'acceptable' }, quotas: [quota('y')] })
  const result = run('coding_hard', [a, b], { a: { x: 30, reset: 2 }, b: { y: 20, reset: 6 } })
  assert.equal(result.primary.providerId, 'a')
  assert.match(result.reason, /Alpha: strong fit for "Heavy coding"/)
  assert.match(result.reason, /Weekly quota at 30% consumed/)
  assert.match(result.reason, /resets in 2d/)
  assert.match(result.reason, /Chosen because scores higher than Beta \(3 vs 2\)/)
  assert.match(result.reason, /Resets in 2d — spend it now before quota refreshes\./)
})

test('reset notes: due today, overdue and not repeated beyond two days', () => {
  const a = service('a', { fits: { coding_hard: 'strong' } })
  assert.match(run('coding_hard', [a], { a: { a_q: 10, reset: 0 } }).reason, /Reset due today/)
  assert.match(run('coding_hard', [a], { a: { a_q: 10, reset: -3 } }).reason, /Reset overdue — consider logging the new reset date/)
  assert.doesNotMatch(run('coding_hard', [a], { a: { a_q: 10, reset: 5 } }).reason, /spend it now/)
})

test('alternatives are capped at 3 in rank order and excluded lists every other provider with its cause', () => {
  const many = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => service(id, { fits: { coding_hard: 'strong' }, resetCycleDays: null, resetType: 'none' }))
  const none = service('n', { fits: {} })
  const values = { p1: { p1_q: 5 }, p2: { p2_q: 10 }, p3: { p3_q: 20 }, p4: { p4_q: 30 }, p5: { p5_q: 40 }, n: { n_q: 0 } }
  const result = run('coding_hard', [...many, none], values)
  assert.equal(result.primary.providerId, 'p1')
  assert.deepEqual(result.alternatives.map((a) => a.providerId), ['p2', 'p3', 'p4'])
  assert.deepEqual(result.excluded.map((e) => e.providerId), ['n'])
  assert.equal(result.rulesetVersion, 2)
  assert.equal(result.taskId, 'coding_hard')
})

test('inputs are not mutated and the result is JSON-serialisable', () => {
  const a = service('a', { fits: { coding_hard: 'strong' } })
  const state = stateFor([a], { a: { a_q: 10, reset: 3 } })
  const before = JSON.stringify([a, state])
  const result = recommend({ task: 'coding_hard', providers: [a], state, now: NOW })
  assert.equal(JSON.stringify([a, state]), before)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
})

// Scenario (before/after): a pay-as-you-go balance wins over a loaded subscription. Before, the reason
// said "Credit at 20% consumed", a number the user never entered and a balance has no maximum for.
test('a balance is described in words, not as an invented percentage', () => {
  const credit = service('c', { name: 'Credits', fits: { coding_hard: 'weak' }, resetType: 'none', resetCycleDays: null, quotas: [quota('c_q', { label: 'Credit', type: 'currency', currency: '$', lowBalance: 5 })] })
  const sub = service('s', { name: 'Sub', fits: { coding_hard: 'strong' }, quotas: [quota('s_q', { label: 'Weekly' })] })
  const result = run('coding_hard', [credit, sub], { c: { c_q: 12.4 }, s: { s_q: 85 } })
  assert.equal(result.primary.providerId, 'c')
  assert.doesNotMatch(result.reason, /consumed/)
  assert.match(result.reason, /Credit above its low-balance level/)
  assert.match(result.reason, /less loaded than Sub \(above its low-balance level vs 85%\)/)
  assert.equal(result.primary.role, 'Weak fit, balance above its low-balance level')
  assert.equal(result.alternatives[0].role, 'Strong fit, 85% used')
})

test('a balance that is running low or nearly out says so', () => {
  const credit = (id) => service(id, { fits: { daily_chat: 'strong' }, resetType: 'none', resetCycleDays: null, quotas: [quota(`${id}_q`, { label: 'Credit', type: 'currency', currency: '$', lowBalance: 10 })] })
  assert.match(run('daily_chat', [credit('a')], { a: { a_q: 7 } }).reason, /Credit running low/)
  assert.match(run('daily_chat', [credit('a')], { a: { a_q: 2 } }).reason, /Credit nearly out/)
})

// Scenario (before/after): a weaker-fit provider is chosen because the better-fitting ones are loaded.
// Before, the reason never said so and the user saw a weak pick with no explanation.
test('a pick that is not the best declared fit names the better-fitting providers it passed over', () => {
  const weak = service('w', { name: 'Weak One', fits: { coding_hard: 'weak' }, quotas: [quota('w_q')] })
  const strong = service('s', { name: 'Strong One', fits: { coding_hard: 'strong' }, quotas: [quota('s_q')] })
  const result = run('coding_hard', [weak, strong], { w: { w_q: 10 }, s: { s_q: 90 } })
  assert.equal(result.primary.providerId, 'w')
  assert.match(result.reason, /Better-fitting but more loaded: Strong One \(strong fit, 90% used\)\./)
})

test('no better-fit note when the pick already has the best declared fit', () => {
  const a = service('a', { name: 'A', fits: { coding_hard: 'strong' }, quotas: [quota('a_q')] })
  const b = service('b', { name: 'B', fits: { coding_hard: 'acceptable' }, quotas: [quota('b_q')] })
  const result = run('coding_hard', [a, b], { a: { a_q: 20 }, b: { b_q: 10 } })
  assert.equal(result.primary.providerId, 'a')
  assert.doesNotMatch(result.reason, /Better-fitting/)
})
