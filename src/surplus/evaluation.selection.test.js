// Selection (FR-008), skips (FR-018), determinism (SC-002) and explanations of contracts/evaluation.md.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { defaultPolicy } from './policy.js'
import { SERVICES } from '../data/services.js'

// Fixed zone, set before any Date is built at module level; restored when the file is done.
const savedTz = process.env.TZ
process.env.TZ = 'Europe/Paris'
after(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz })

const NOW = new Date(2026, 10, 3, 12, 0)
const HOUR = 3600000
const ago = (hours) => new Date(NOW.getTime() - hours * HOUR).toISOString()
const pad = (n) => String(n).padStart(2, '0')
const lastResetFor = (daysToReset) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + daysToReset - 7)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function stateFor({ claudeDays = 2, chatgptDays = 2, claudeWeeklyConsumed = 40, chatgptRemaining = 75 } = {}) {
  return {
    claude: {
      weekly: claudeWeeklyConsumed, slot5h: 40, __last_reset_date: lastResetFor(claudeDays),
      __ts_weekly: ago(1), __ts_slot5h: ago(1),
    },
    chatgpt: {
      codex_remaining: chatgptRemaining, codex_5h: 60, __last_reset_date: lastResetFor(chatgptDays),
      __ts_codex_remaining: ago(1), __ts_codex_5h: ago(1),
    },
  }
}

function policyOn(ids = ['claude']) {
  const p = defaultPolicy()
  for (const id of ids) p.services[id].surplusEnabled = true
  return p
}

const idea = (over = {}) => ({
  id: 'i1', text: 'An idea', context: '', workingFolder: null, priority: 'normal', size: 'medium',
  status: 'waiting', createdAt: '2026-11-01T08:00:00.000Z', ...over,
})

const run = (over = {}) => ({
  id: 'r1', ideaId: 'i1', serviceId: 'claude', mode: 'auto', cycleKey: `claude:2026-11-05`, status: 'failed',
  ideaSnapshot: { text: 't', context: '', workingFolder: null, resolvedFolder: null, contentVersion: 1 }, ...over,
})

function evaluate(over = {}) {
  return evaluateSurplus({
    now: NOW, state: stateFor(), services: SERVICES, policy: policyOn(), ideas: [idea()], runs: [], folderChecks: null, mode: 'preview', ...over,
  })
}

test('priority beats size and age', () => {
  const ideas = [
    idea({ id: 'a', priority: 'low', size: 'large', createdAt: '2026-10-01T00:00:00.000Z' }),
    idea({ id: 'b', priority: 'normal', size: 'small' }),
    idea({ id: 'c', priority: 'high', size: 'small', createdAt: '2026-11-02T00:00:00.000Z' }),
  ]
  assert.equal(evaluate({ ideas }).selected.ideaId, 'c')
  assert.equal(evaluate({ ideas: ideas.slice(0, 2) }).selected.ideaId, 'b')
})

test('within a priority the largest size that fits remaining minus reserve wins', () => {
  // weekly remaining 60, reserve 20 -> room 40: large (15) fits
  const ideas = [idea({ id: 's', size: 'small' }), idea({ id: 'l', size: 'large' }), idea({ id: 'm', size: 'medium' })]
  assert.equal(evaluate({ ideas }).selected.ideaId, 'l')
  // remaining 40 -> room 20: large (15) still fits; remaining 33 -> room 13: large does not, medium does
  const tight = stateFor({ claudeWeeklyConsumed: 67 })
  const result = evaluate({ ideas, state: tight })
  assert.equal(result.selected.ideaId, 'm')
  assert.ok(result.services[0].skipped.some((s) => s.ideaId === 'l' && s.reason === 'insufficient_weekly_room'))
})

test('same priority and size: oldest createdAt first, then id', () => {
  const ideas = [
    idea({ id: 'b', createdAt: '2026-11-02T00:00:00.000Z' }),
    idea({ id: 'a', createdAt: '2026-11-02T00:00:00.000Z' }),
    idea({ id: 'z', createdAt: '2026-10-30T00:00:00.000Z' }),
  ]
  assert.equal(evaluate({ ideas }).selected.ideaId, 'z')
  assert.equal(evaluate({ ideas: ideas.slice(0, 2) }).selected.ideaId, 'a')
})

test('input order never changes the choice', () => {
  const ideas = [
    idea({ id: 'a', size: 'small' }), idea({ id: 'b', size: 'medium' }), idea({ id: 'c', size: 'large', priority: 'low' }),
  ]
  const forward = evaluate({ ideas })
  const backward = evaluate({ ideas: [...ideas].reverse() })
  assert.deepEqual(forward, backward)
})

test('services: soonest reset first, others become alternatives', () => {
  const state = stateFor({ claudeDays: 2, chatgptDays: 1 })
  const result = evaluate({ state, policy: policyOn(['claude', 'chatgpt']) })
  assert.equal(result.selected.serviceId, 'chatgpt')
  assert.deepEqual(result.selected.alternatives, ['claude'])
})

test('services: equal reset day falls back to SERVICES order', () => {
  const result = evaluate({ state: stateFor(), policy: policyOn(['claude', 'chatgpt']) })
  assert.equal(result.selected.serviceId, 'claude')
  assert.deepEqual(result.selected.alternatives, ['chatgpt'])
})

test('a service that is not eligible is neither selected nor an alternative', () => {
  const state = stateFor({ claudeDays: 1, chatgptDays: 2 })
  state.claude.__ts_weekly = ago(20)
  const result = evaluate({ state, policy: policyOn(['claude', 'chatgpt']) })
  assert.equal(result.selected.serviceId, 'chatgpt')
  assert.deepEqual(result.selected.alternatives, [])
})

test('folderChecks failures skip the idea with a reason; the next idea is chosen', () => {
  const ideas = [idea({ id: 'a', priority: 'high', workingFolder: '/p/a' }), idea({ id: 'b', workingFolder: '/p/b' })]
  const result = evaluate({ ideas, folderChecks: { a: { ok: false, code: 'folder_not_found' }, b: { ok: true } } })
  assert.equal(result.selected.ideaId, 'b')
  assert.deepEqual(result.services[0].skipped.find((s) => s.ideaId === 'a').reason, 'folder_not_found')
})

test('folderChecks null (browser) skips nothing; in auto mode an unchecked idea is skipped', () => {
  assert.equal(evaluate({ folderChecks: null }).selected.ideaId, 'i1')
  const auto = evaluate({ mode: 'auto', folderChecks: null })
  assert.equal(auto.selected, null)
  assert.equal(auto.services[0].skipped[0].reason, 'folder_not_checked')
  assert.equal(evaluate({ mode: 'auto', folderChecks: { i1: { ok: true } } }).selected.ideaId, 'i1')
})

test('failed or interrupted auto run in the same cycleKey: retry used (FR-018)', () => {
  for (const status of ['failed', 'interrupted']) {
    const result = evaluate({ runs: [run({ status })] })
    assert.equal(result.selected, null, status)
    assert.deepEqual(result.services[0].skipped, [{ ideaId: 'i1', reason: 'retry_used', detail: result.services[0].skipped[0].detail }])
  }
})

test('retry is available again in another cycle, after a success, or for manual records', () => {
  assert.equal(evaluate({ runs: [run({ cycleKey: 'claude:2026-10-29' })] }).selected.ideaId, 'i1')
  assert.equal(evaluate({ runs: [run({ status: 'completed' })] }).selected.ideaId, 'i1')
  assert.equal(evaluate({ runs: [run({ serviceId: 'chatgpt', cycleKey: 'chatgpt:2026-11-05' })] }).selected.ideaId, 'i1')
})

test('an idea with a retry used does not block the other waiting ideas', () => {
  const ideas = [idea({ id: 'a', priority: 'high' }), idea({ id: 'b' })]
  assert.equal(evaluate({ ideas, runs: [run({ ideaId: 'a' })] }).selected.ideaId, 'b')
})

test('an idea whose resolved folder is in use by a running run is skipped (running_elsewhere)', () => {
  const ideas = [idea({ id: 'a', priority: 'high', workingFolder: '/p/shared' }), idea({ id: 'b', workingFolder: '/p/other' })]
  const running = run({ id: 'r2', ideaId: 'x', status: 'running', cycleKey: 'claude:2026-11-05', ideaSnapshot: { text: 't', context: '', workingFolder: '/p/shared', resolvedFolder: '/p/shared', contentVersion: 1 } })
  const result = evaluate({ ideas, runs: [running] })
  assert.equal(result.selected.ideaId, 'b')
  assert.equal(result.services[0].skipped.find((s) => s.ideaId === 'a').reason, 'running_elsewhere')
})

test('resolved folders compare after normalisation and base-folder resolution', () => {
  const policy = policyOn()
  policy.projectsBaseFolder = '/work'
  const ideas = [idea({ id: 'a', priority: 'high', workingFolder: 'site/../site/' })]
  const running = run({ ideaId: 'x', status: 'running', ideaSnapshot: { text: 't', context: '', workingFolder: '/work/site', resolvedFolder: '/work/site', contentVersion: 1 } })
  assert.equal(evaluate({ policy, ideas, runs: [running] }).selected, null)
})

test('a running idea also reserves its folder through folderChecks.resolvedFolder', () => {
  const ideas = [idea({ id: 'a', workingFolder: '~/p' }), idea({ id: 'x', status: 'running', workingFolder: '/home/u/p' })]
  const result = evaluate({ ideas, folderChecks: { a: { ok: true, resolvedFolder: '/home/u/p' }, x: { ok: true, resolvedFolder: '/home/u/p' } } })
  assert.equal(result.selected, null)
  assert.equal(result.services[0].skipped[0].reason, 'running_elsewhere')
})

test('two waiting ideas with the same folder: exactly one is selected', () => {
  const ideas = [idea({ id: 'a', workingFolder: '/p/x' }), idea({ id: 'b', workingFolder: '/p/x' })]
  const result = evaluate({ ideas })
  assert.equal(result.selected.ideaId, 'a')
  assert.ok(result.selected.ideaId !== 'b')
})

test('determinism: same input gives deep-equal, JSON-stable output (SC-002)', () => {
  const input = {
    now: NOW, state: stateFor({ claudeDays: 1 }), services: SERVICES, policy: policyOn(['claude', 'chatgpt']),
    ideas: [idea({ id: 'a' }), idea({ id: 'b', size: 'small' }), idea({ id: 'c', priority: 'high', workingFolder: '/p' })],
    runs: [run({ ideaId: 'a' })], folderChecks: { c: { ok: true } }, mode: 'preview',
  }
  const snapshot = JSON.stringify(input)
  const first = evaluateSurplus(input)
  const second = evaluateSurplus(structuredClone(input))
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.equal(JSON.stringify(input), snapshot, 'inputs are not mutated')
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(first))), JSON.stringify(first), 'no undefined or non-JSON values')
})

test('reason is never empty, selected or not', () => {
  const cases = [
    evaluate(),
    evaluate({ ideas: [] }),
    evaluate({ policy: defaultPolicy() }),
    evaluate({ services: [] }),
    evaluate({ state: {} }),
  ]
  for (const e of cases) {
    assert.equal(typeof e.reason, 'string')
    assert.ok(e.reason.length > 0)
    for (const s of e.services) assert.ok(s.reason.length > 0)
  }
})

test('no waiting idea: states the reason (US2 scenario 5)', () => {
  const result = evaluate({ ideas: [] })
  assert.equal(result.selected, null)
  assert.match(result.reason, /no waiting idea/i)
})

test('no service eligible: states which rule blocked each service', () => {
  const state = stateFor()
  state.claude.__ts_weekly = ago(20)
  state.chatgpt.__ts_codex_5h = ago(8)
  const result = evaluate({ state, policy: policyOn(['claude', 'chatgpt']), ideas: [idea()] })
  assert.equal(result.selected, null)
  assert.match(result.reason, /Claude/)
  assert.match(result.reason, /ChatGPT.*session reading older than 5 h/)
  assert.match(result.reason, /older than 12 h/)
})

test('surplus off everywhere: reason says so', () => {
  const result = evaluate({ policy: defaultPolicy() })
  assert.equal(result.selected, null)
  assert.match(result.reason, /off/i)
})

test('invalid arguments throw', () => {
  assert.throws(() => evaluate({ now: 'today' }), TypeError)
  assert.throws(() => evaluate({ mode: 'yolo' }), TypeError)
})
