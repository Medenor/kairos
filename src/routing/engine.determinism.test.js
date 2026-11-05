import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { addProvider, removeProvider } from '../providers/catalogue.js'
import { emptyCatalogue } from '../providers/records.js'
import { toRuntimeServices } from '../providers/runtime.js'
import { sampleInput, sequentialIds } from '../providers/fixtures/sampleProviders.js'
import { NOW, quota, service, shuffle, stateFor } from './routing.testkit.js'

const TASK = 'coding_hard'

function sixProviders() {
  const names = ['Alpha', 'alpine', 'Beta', 'alpha ', 'Zeta', 'Éclair']
  return names.map((name, i) => service(`p${i}`, {
    name,
    fits: { [TASK]: i % 2 === 0 ? 'strong' : 'acceptable' },
    quotas: [quota(`p${i}_q`)],
  }))
}

// Ties everywhere: equal fit and pressure, so name and id decide.
const TIED = { p0: { p0_q: 40, reset: 3 }, p1: { p1_q: 40, reset: 3 }, p2: { p2_q: 40, reset: 3 }, p3: { p3_q: 40, reset: 3 }, p4: { p4_q: 40, reset: 3 }, p5: { p5_q: 40, reset: 3 } }
const MIXED = { p0: { p0_q: 40, reset: 3 }, p1: { p1_q: 12, reset: 1 }, p2: { p2_q: 44, reset: 6 }, p3: { p3_q: 12, reset: 9 }, p4: { p4_q: 80, reset: 2 }, p5: { p5_q: 100, reset: 2 } }

test('200 seeded permutations of six providers yield deep-equal recommendations (FR-014, SC-004)', () => {
  for (const values of [TIED, MIXED]) {
    const providers = sixProviders()
    const state = stateFor(providers, values)
    const baseline = recommend({ task: TASK, providers, state, now: NOW })
    for (let seed = 1; seed <= 200; seed += 1) {
      const result = recommend({ task: TASK, providers: shuffle(providers, seed), state, now: NOW })
      assert.deepEqual(result, baseline, `seed ${seed}`)
    }
  }
})

test('repeated calls are deep-equal', () => {
  const providers = sixProviders()
  const state = stateFor(providers, MIXED)
  assert.deepEqual(recommend({ task: TASK, providers, state, now: NOW }), recommend({ task: TASK, providers, state, now: NOW }))
})

test('creation order never matters: ids in either order give the same primary', () => {
  const providers = sixProviders()
  const state = stateFor(providers, TIED)
  const forward = recommend({ task: TASK, providers, state, now: NOW })
  const backward = recommend({ task: TASK, providers: [...providers].reverse(), state, now: NOW })
  assert.equal(forward.primary.providerId, backward.primary.providerId)
  assert.deepEqual(forward, backward)
})

test('twenty providers of four quotas each complete and give the same result when shuffled (FR-009, SC-009)', () => {
  const providers = Array.from({ length: 20 }, (_, i) =>
    service(`q${i}`, {
      name: `Provider ${String(i % 7)}`,
      fits: { [TASK]: ['strong', 'acceptable', 'weak'][i % 3] },
      quotas: [0, 1, 2, 3].map((k) => quota(`q${i}_${k}`, { gates: k === 3 ? ['oneshot'] : null })),
    }))
  const values = {}
  providers.forEach((p, i) => {
    values[p.id] = { reset: (i % 9) + 1 }
    p.quotas.forEach((q, k) => { values[p.id][q.id] = (i * 7 + k * 13) % 95 })
  })
  const state = stateFor(providers, values)
  const baseline = recommend({ task: TASK, providers, state, now: NOW })
  assert.ok(baseline.primary)
  for (let seed = 1; seed <= 25; seed += 1) {
    assert.deepEqual(recommend({ task: TASK, providers: shuffle(providers, seed), state, now: NOW }), baseline)
  }
})

test('adding a provider or removing the primary changes the result as the rules dictate (FR-017)', () => {
  const a = service('a', { name: 'A', fits: { [TASK]: 'acceptable' } })
  const b = service('b', { name: 'B', fits: { [TASK]: 'strong' } })
  const both = recommend({ task: TASK, providers: [a, b], state: stateFor([a, b], { a: { a_q: 10 }, b: { b_q: 10 } }), now: NOW })
  assert.equal(both.primary.providerId, 'b')
  const alone = recommend({ task: TASK, providers: [a], state: stateFor([a], { a: { a_q: 10 } }), now: NOW })
  assert.equal(alone.primary.providerId, 'a')
  assert.equal(JSON.stringify(alone).includes('"b"'), false)
})

test('tieBreak.criterion names the first differing criterion', () => {
  const mk = (id, fit, pct, reset, name = id) => ({ svc: service(id, { name, fits: { [TASK]: fit } }), values: { [`${id}_q`]: pct, reset } })
  const criterion = (x, y) => {
    const providers = [x.svc, y.svc]
    const state = stateFor(providers, { [x.svc.id]: x.values, [y.svc.id]: y.values })
    return recommend({ task: TASK, providers, state, now: NOW }).tieBreak.criterion
  }
  assert.equal(criterion(mk('a', 'strong', 10, 3), mk('b', 'acceptable', 10, 3)), 'score')
  assert.equal(criterion(mk('a', 'strong', 10, 3), mk('b', 'strong', 40, 3)), 'pressure_bucket')
  assert.equal(criterion(mk('a', 'strong', 40, 1), mk('b', 'strong', 31, 5)), 'reset')
  assert.equal(criterion(mk('a', 'strong', 31, 3), mk('b', 'strong', 40, 3)), 'pressure')
  assert.equal(criterion(mk('a', 'strong', 31, 3), mk('b', 'strong', 31, 3)), 'name')
  // 'fit' only differs after score, bucket, reset and pressure are equal: strong at >=60 (score 2) vs acceptable at the same load has score 1, so fit alone cannot separate equal-score providers within a bucket
  assert.equal(criterion(mk('a', 'strong', 62, 3), mk('b', 'acceptable', 20, 3)), 'pressure_bucket')
})

test('removing the primary through removeProvider: the new result no longer mentions it (FR-017)', () => {
  const newId = sequentialIds()
  const NOW_ISO = new Date('2026-03-04T10:00:00.000Z')
  let catalogue = emptyCatalogue()
  let state = {}
  for (const name of ['Primary Co', 'Fallback Co']) {
    const input = sampleInput({
      name, schedule: { type: 'none' }, surplus: null, fits: { coding_hard: name === 'Primary Co' ? 'strong' : 'acceptable' },
      quotas: [{ label: 'Pct', type: 'consumed_pct', value: 10 }],
    })
    const out = addProvider({ catalogue, state, input, now: NOW_ISO, newId })
    ;({ catalogue, state } = out)
  }
  const before = recommend({ task: TASK, providers: toRuntimeServices(catalogue), state, now: NOW })
  assert.equal(before.primary.name, 'Primary Co')
  const removed = removeProvider({ catalogue, state, id: before.primary.providerId, now: NOW_ISO })
  const after = recommend({ task: TASK, providers: toRuntimeServices(removed.catalogue), state: removed.state, now: NOW })
  assert.equal(after.primary.name, 'Fallback Co')
  const text = JSON.stringify(after)
  assert.equal(text.includes(before.primary.providerId), false)
  assert.equal(text.includes('Primary Co'), false)
})
