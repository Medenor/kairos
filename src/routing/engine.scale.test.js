// Performance guard (FR-009, SC-009): 20 providers x 8 quotas stay fast and independent of input order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { recommend } from './engine.js'
import { evaluateSurplus } from '../surplus/evaluation.js'
import { defaultPolicy, defaultProviderSurplus } from '../surplus/policy.js'
import { createWeeklySnapshot, deriveProviderHistorySeries, getLocalWeekKey, recordWeeklySnapshot } from '../utils.js'
import { NOW, quota, service, shuffle } from './routing.testkit.js'

const TASKS = ['coding_hard', 'coding_light', 'work_heavy', 'daily_chat', 'oneshot']
const BOUND_MS = 200

const providers = Array.from({ length: 20 }, (_, i) =>
  service(`p${String(i).padStart(2, '0')}`, {
    name: `Provider ${i % 6}`,
    fits: Object.fromEntries(TASKS.map((t, k) => [t, ['strong', 'acceptable', 'weak', 'none'][(i + k) % 4]])),
    quotas: Array.from({ length: 8 }, (_, k) => quota(`p${String(i).padStart(2, '0')}_${k}`, { gates: k % 2 ? null : TASKS.slice(0, 1 + (k % 5)), label: `Q${k}` })),
    surplus: i % 3 === 0 ? { tool: 'claude', weeklyQuotaId: `p${String(i).padStart(2, '0')}_0`, sessionQuotaId: `p${String(i).padStart(2, '0')}_1` } : null,
  }))
const state = {}
providers.forEach((p, i) => {
  state[p.id] = { __last_reset_date: '2026-03-01' }
  p.quotas.forEach((q, k) => {
    state[p.id][q.id] = (i * 11 + k * 7) % 90
    state[p.id][`__ts_${q.id}`] = new Date(NOW.getTime() - 3600000).toISOString()
  })
})

function timed(fn) {
  const start = process.hrtime.bigint()
  const result = fn()
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 }
}

test('recommend over 20 providers x 8 quotas, all five tasks: fast and equal under shuffling', () => {
  for (const task of TASKS) {
    const base = timed(() => recommend({ task, providers, state, now: NOW }))
    assert.ok(base.ms < BOUND_MS, `${task} took ${base.ms} ms`)
    for (let seed = 1; seed <= 5; seed += 1) {
      assert.deepEqual(recommend({ task, providers: shuffle(providers, seed), state, now: NOW }), base.result, `${task} seed ${seed}`)
    }
  }
})

test('evaluateSurplus over the same providers: fast and equal under shuffling', () => {
  const policy = defaultPolicy()
  for (const p of providers) policy.providers[p.id] = { ...defaultProviderSurplus(), surplusEnabled: true }
  const run = (list) => evaluateSurplus({ now: NOW, state, services: list, policy, ideas: [], runs: [], folderChecks: null, mode: 'preview' })
  const base = timed(() => run(providers))
  assert.ok(base.ms < BOUND_MS, `took ${base.ms} ms`)
  for (let seed = 1; seed <= 5; seed += 1) {
    const other = run(shuffle(providers, seed))
    assert.deepEqual(other.selected, base.result.selected)
    assert.equal(other.reason, base.result.reason)
  }
})

test('snapshot creation and 52 weeks of provider history: fast and complete', () => {
  const snap = timed(() => createWeeklySnapshot({ workspaceId: 'ws', state, providers, now: NOW }))
  assert.ok(snap.ms < BOUND_MS, `snapshot took ${snap.ms} ms`)
  assert.equal(Object.keys(snap.result.providers).length, 20)

  let history = []
  for (let week = 51; week >= 0; week -= 1) {
    const at = new Date(NOW.getTime() - week * 7 * 86400000)
    history = recordWeeklySnapshot(history, { workspaceId: 'ws', state, providers, now: at })
  }
  const series = timed(() => deriveProviderHistorySeries({ history, providerId: providers[7].id, providers, fromWeekKey: getLocalWeekKey(new Date(NOW.getTime() - 51 * 7 * 86400000)).weekKey, toWeekKey: getLocalWeekKey(NOW).weekKey }))
  assert.ok(series.ms < BOUND_MS, `series took ${series.ms} ms`)
  assert.equal(series.result.recordedWeekCount, 52)
  const shuffled = deriveProviderHistorySeries({ history: shuffle(history, 3), providerId: providers[7].id, providers: shuffle(providers, 3), fromWeekKey: getLocalWeekKey(new Date(NOW.getTime() - 51 * 7 * 86400000)).weekKey, toWeekKey: getLocalWeekKey(NOW).weekKey })
  assert.deepEqual(shuffled, series.result)
})
