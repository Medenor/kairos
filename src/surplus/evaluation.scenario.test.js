// Before/after scenario of quickstart.md section 2 (constitution III), consistency with the routing
// rules (research D14) and the local-midnight day count (research D3).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { legacyPolicy as defaultPolicy } from '../providers/fixtures/legacyServices.js'
import { LEGACY_SERVICES as SERVICES } from '../providers/fixtures/legacyServices.js'
import { RULES } from '../routing/fixtures/legacyRules.js'
import { getResetInfo, getConsumedPct } from '../utils.js'

// Fixed zone, set before any Date is built at module level; restored when the file is done.
const savedTz = process.env.TZ
process.env.TZ = 'Europe/Paris'
after(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz })

const HOUR = 3600000
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lastResetFor = (now, daysToReset) =>
  localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToReset - 7))

// Quickstart state: Claude weekly 40% consumed, 5 h slot 40% consumed, reset in 2 days.
function quickstartState(now, { ageH = 2, daysToReset = 2 } = {}) {
  const stamp = new Date(now.getTime() - ageH * HOUR).toISOString()
  return {
    claude: { weekly: 40, slot5h: 40, __last_reset_date: lastResetFor(now, daysToReset), __ts_weekly: stamp, __ts_slot5h: stamp },
    copilot: { monthly: 20 },
    chatgpt: { codex_remaining: 75, codex_5h: 60 },
    openrouter: { credits: 10 },
    kilocode: { credits: 8 },
  }
}

const mediumIdea = {
  id: 'idea-1', text: 'Refactor the parser', context: '', workingFolder: null, priority: 'normal', size: 'medium',
  status: 'waiting', createdAt: '2026-11-01T08:00:00.000Z',
}

function run(now, state) {
  const policy = defaultPolicy()
  policy.providers.claude.surplusEnabled = true
  return evaluateSurplus({ now, state, services: SERVICES, policy, ideas: [mediumIdea], runs: [], folderChecks: null, mode: 'preview' })
}

const NOW = new Date(2026, 10, 3, 14, 0)

test('quickstart: fresh values, reset in 2 days -> a suggestion with each rule outcome', () => {
  const evaluation = run(NOW, quickstartState(NOW))
  assert.equal(evaluation.selected.serviceId, 'claude')
  assert.equal(evaluation.selected.ideaId, 'idea-1')
  const claude = evaluation.services.find((s) => s.serviceId === 'claude')
  assert.equal(claude.eligible, true)
  assert.deepEqual(claude.rules.map((r) => [r.id, r.pass]), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].map((id) => [id, true]))
  // 60% remaining minus 20% reserve minus 8% cost leaves 32%
  assert.equal(claude.inputs.weeklyRemainingPct, 60)
  assert.equal(claude.candidate.costPct, 8)
  assert.match(claude.rules.find((r) => r.id === 'R4').detail, /60/)
  assert.match(claude.rules.find((r) => r.id === 'R4').detail, /20/)
  assert.match(claude.rules.find((r) => r.id === 'R4').detail, /8/)
  assert.match(claude.reason, /32/)
  assert.ok(evaluation.reason.length > 0)
  // the other (surplus-off) service is not eligible
  assert.equal(evaluation.services.find((s) => s.serviceId === 'chatgpt').eligible, false)
})

test('quickstart: same state confirmed 20 h ago -> no suggestion, reason names the stale reading', () => {
  const evaluation = run(NOW, quickstartState(NOW, { ageH: 20 }))
  assert.equal(evaluation.selected, null)
  assert.match(evaluation.reason, /weekly reading older than 12 h/)
  assert.match(evaluation.reason, /confirm/i)
})

test('quickstart: same state, reset due today -> no suggestion, reason "reset due today"', () => {
  const evaluation = run(NOW, quickstartState(NOW, { daysToReset: 0 }))
  assert.equal(evaluation.selected, null)
  assert.match(evaluation.reason, /reset due today/i)
})

test('quickstart: before the feature no suggestion existed (state without stamps is never eligible)', () => {
  const state = quickstartState(NOW)
  delete state.claude.__ts_weekly
  delete state.claude.__ts_slot5h
  const evaluation = run(NOW, state)
  assert.equal(evaluation.selected, null)
})

// Consistency with src/data/rules.js (research D14).
const quotaOf = (svc, id) => svc.quotas.find((q) => q.id === id)

test('an eligible service is never blocked in the routing rules and the "Resets in Nd" note agrees', () => {
  const state = quickstartState(NOW)
  const policy = defaultPolicy()
  policy.providers.claude.surplusEnabled = true
  policy.providers.chatgpt.surplusEnabled = true
  state.chatgpt.__last_reset_date = lastResetFor(NOW, 1)
  state.chatgpt.__ts_codex_remaining = new Date(NOW.getTime() - HOUR).toISOString()
  state.chatgpt.__ts_codex_5h = new Date(NOW.getTime() - HOUR).toISOString()
  const evaluation = evaluateSurplus({ now: NOW, state, services: SERVICES, policy, ideas: [mediumIdea], runs: [], folderChecks: null, mode: 'preview' })

  const signals = {}
  for (const svc of SERVICES) signals[svc.id] = getResetInfo(state[svc.id]?.__last_reset_date ?? null, svc.resetCycleDays, NOW)

  const eligible = evaluation.services.filter((s) => s.eligible)
  assert.equal(eligible.length, 2)
  for (const s of eligible) {
    const svc = SERVICES.find((x) => x.id === s.serviceId)
    const weekly = quotaOf(svc, svc.surplus.weeklyQuotaId)
    const session = quotaOf(svc, svc.surplus.sessionQuotaId)
    // Not blocked in the sense of the routing rules (consumed < 100 on both quotas).
    assert.ok(getConsumedPct(weekly, state[svc.id][weekly.id]) < 100, `${svc.id} weekly`)
    assert.ok(getConsumedPct(session, state[svc.id][session.id]) < 100, `${svc.id} session`)
    // Notice and dashboard agree on the day count.
    assert.equal(s.inputs.daysToReset, signals[svc.id].daysRemaining)
  }

  // The routing rules do not treat Claude as blocked and print the same "Resets in Nd".
  const hard = RULES.coding_hard(state, signals)
  assert.equal(hard.primary, 'claude')
  assert.ok(hard.reason.includes(`Resets in ${eligible.find((s) => s.serviceId === 'claude').inputs.daysToReset}d`))
  assert.ok(!/blocked/i.test(hard.reason))
  const work = RULES.work_heavy(state, signals)
  assert.equal(work.primary, 'claude')
  assert.ok(work.reason.includes('Resets in 2d'))
})

test('a service the routing rules treat as blocked is never eligible', () => {
  const state = quickstartState(NOW)
  state.claude.weekly = 100 // weekly exhausted: claudeBlocked
  const evaluation = run(NOW, state)
  assert.equal(evaluation.services.find((s) => s.serviceId === 'claude').eligible, false)
  assert.equal(evaluation.selected, null)
  const signals = { claude: getResetInfo(state.claude.__last_reset_date, 7, NOW), copilot: getResetInfo(null, 30, NOW), chatgpt: getResetInfo(null, 7, NOW) }
  assert.match(RULES.work_heavy(state, signals).reason, /blocked|nearly exhausted/i)
})

// Midnight: dashboard and evaluation use the same local calendar day (research D3).
for (const tz of ['Europe/Paris', 'Pacific/Auckland', 'America/Los_Angeles']) {
  test(`midnight in ${tz}: getResetInfo and the evaluation agree on daysRemaining at 23:59 and 00:01`, () => {
    process.env.TZ = tz
    const before = new Date(2026, 10, 3, 23, 59) // local
    const after = new Date(2026, 10, 4, 0, 1) // local, two minutes later
    const lastReset = '2026-10-30' // next reset 2026-11-06
    const days = {}
    for (const [label, now] of [['before', before], ['after', after]]) {
      const state = quickstartState(now)
      state.claude.__last_reset_date = lastReset
      const info = getResetInfo(lastReset, 7, now)
      const evaluation = run(now, state)
      const claude = evaluation.services.find((s) => s.serviceId === 'claude')
      assert.equal(claude.inputs.daysToReset, info.daysRemaining, `${label} daysRemaining`)
      assert.equal(claude.inputs.nextResetDate, info.nextResetDate, `${label} nextResetDate`)
      days[label] = info.daysRemaining
    }
    assert.equal(days.before, 3)
    assert.equal(days.after, 2)
    assert.equal(after.getTime() - before.getTime(), 2 * 60000)
  })
}
