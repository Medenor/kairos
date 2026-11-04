// Rules R1 to R7 of contracts/evaluation.md: one passing and one failing case each (FR-007).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { defaultPolicy } from './policy.js'
import { SERVICES } from '../data/services.js'

// Fixed zone, set before any Date is built at module level; restored when the file is done.
const savedTz = process.env.TZ
process.env.TZ = 'Europe/Paris'
after(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz })

// 2026-11-03 is a Tuesday.
const NOW = new Date(2026, 10, 3, 12, 0)
const HOUR = 3600000
const ago = (hours, now = NOW) => new Date(now.getTime() - hours * HOUR).toISOString()
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Last reset date such that the next reset is `daysToReset` local days after `now` (cycle is 7 days).
const lastResetFor = (now, daysToReset) =>
  localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToReset - 7))

function claudeState({ now = NOW, daysToReset = 2, weeklyConsumed = 40, sessionConsumed = 40, weeklyAgeH = 2, sessionAgeH = 2, lastReset } = {}) {
  return {
    claude: {
      weekly: weeklyConsumed,
      slot5h: sessionConsumed,
      __last_reset_date: lastReset !== undefined ? lastReset : lastResetFor(now, daysToReset),
      __ts_weekly: weeklyAgeH === null ? null : ago(weeklyAgeH, now),
      __ts_slot5h: sessionAgeH === null ? null : ago(sessionAgeH, now),
    },
  }
}

function policyWith(claude = {}, extra = {}) {
  const p = defaultPolicy()
  p.services.claude = { ...p.services.claude, surplusEnabled: true, ...claude }
  return { ...p, ...extra }
}

const idea = (over = {}) => ({
  id: 'i1', text: 'Write the tests', context: '', workingFolder: null, priority: 'normal', size: 'medium',
  status: 'waiting', createdAt: '2026-11-01T08:00:00.000Z', ...over,
})

function evalClaude({ now = NOW, state = claudeState({ now }), policy = policyWith(), ideas = [idea()], runs = [], folderChecks = null, mode = 'preview' } = {}) {
  const evaluation = evaluateSurplus({ now, state, services: SERVICES, policy, ideas, runs, folderChecks, mode })
  const svc = evaluation.services.find((s) => s.serviceId === 'claude')
  const rule = (id) => svc.rules.find((r) => r.id === id)
  return { evaluation, svc, rule }
}

test('result shape: fixed rule order, versioned, ISO time, reason always present', () => {
  const { evaluation, svc } = evalClaude()
  assert.equal(evaluation.rulesetVersion, 1)
  assert.equal(evaluation.evaluatedAt, NOW.toISOString())
  assert.deepEqual(svc.rules.map((r) => r.id), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'])
  for (const r of svc.rules) {
    assert.equal(typeof r.pass, 'boolean')
    assert.ok(r.detail.length > 0)
  }
  assert.equal(svc.eligible, true)
  assert.deepEqual(evaluation.services.map((s) => s.serviceId), ['claude', 'chatgpt'], 'only services with a surplus block')
  assert.ok(evaluation.reason.length > 0)
  assert.ok(svc.reason.length > 0)
})

test('inputs expose the values the rules used', () => {
  const { svc } = evalClaude()
  assert.equal(svc.inputs.daysToReset, 2)
  assert.equal(svc.inputs.nextResetDate, localDate(new Date(2026, 10, 5)))
  assert.equal(svc.inputs.weeklyRemainingPct, 60)
  assert.equal(svc.inputs.sessionRemainingPct, 60)
  assert.equal(svc.inputs.weeklyAgeHours, 2)
  assert.equal(svc.inputs.sessionAgeHours, 2)
  assert.equal(svc.inputs.reservePct, 20)
  assert.equal(svc.inputs.windowDays, 2)
})

test('ChatGPT quotas normalise from remaining_pct (100 - consumed)', () => {
  const state = {
    chatgpt: {
      codex_remaining: 75, codex_5h: 60,
      __last_reset_date: lastResetFor(NOW, 1),
      __ts_codex_remaining: ago(1), __ts_codex_5h: ago(1),
    },
  }
  const policy = defaultPolicy()
  policy.services.chatgpt.surplusEnabled = true
  const evaluation = evaluateSurplus({ now: NOW, state, services: SERVICES, policy, ideas: [idea()], runs: [], folderChecks: null, mode: 'preview' })
  const svc = evaluation.services.find((s) => s.serviceId === 'chatgpt')
  assert.equal(svc.inputs.weeklyRemainingPct, 75)
  assert.equal(svc.inputs.sessionRemainingPct, 60)
  assert.equal(svc.eligible, true)
})

// R1
test('R1 passes when surplus is on for the service', () => {
  assert.equal(evalClaude().rule('R1').pass, true)
})
test('R1 fails when surplus is off, and the service is not eligible', () => {
  const { rule, svc } = evalClaude({ policy: policyWith({ surplusEnabled: false }) })
  assert.equal(rule('R1').pass, false)
  assert.equal(svc.eligible, false)
  assert.equal(svc.candidate, null)
})

// R2
test('R2 passes inside the window (1 and 2 days with the default window)', () => {
  for (const days of [1, 2]) {
    const { rule } = evalClaude({ state: claudeState({ daysToReset: days }) })
    assert.equal(rule('R2').pass, true, `${days} day(s)`)
  }
})
test('R2 fails when the reset date is unset', () => {
  const { rule } = evalClaude({ state: claudeState({ lastReset: null }) })
  assert.equal(rule('R2').pass, false)
  assert.match(rule('R2').detail, /not set/i)
})
test('R2 fails when the reset date is invalid', () => {
  const { rule } = evalClaude({ state: claudeState({ lastReset: 'garbage' }) })
  assert.equal(rule('R2').pass, false)
  assert.match(rule('R2').detail, /invalid/i)
})
test('R2 fails when the last reset date is in the future', () => {
  const { rule } = evalClaude({ state: claudeState({ lastReset: localDate(new Date(2026, 10, 4)) }) })
  assert.equal(rule('R2').pass, false)
  assert.match(rule('R2').detail, /future/i)
})
test('R2 fails when the reset is due today', () => {
  const { rule, svc } = evalClaude({ state: claudeState({ daysToReset: 0 }) })
  assert.equal(rule('R2').pass, false)
  assert.match(rule('R2').detail, /due today/i)
  assert.match(svc.reason, /due today/i)
})
test('R2 fails when the reset is overdue', () => {
  const { rule } = evalClaude({ state: claudeState({ daysToReset: -1 }) })
  assert.equal(rule('R2').pass, false)
  assert.match(rule('R2').detail, /overdue/i)
})
test('R2 fails beyond the window and respects a per-service window', () => {
  assert.equal(evalClaude({ state: claudeState({ daysToReset: 3 }) }).rule('R2').pass, false)
  assert.equal(evalClaude({ state: claudeState({ daysToReset: 3 }), policy: policyWith({ windowDays: 3 }) }).rule('R2').pass, true)
})

// R3
test('R3 passes with a weekly reading 11 h old (limit 12 h) and at exactly 12 h', () => {
  assert.equal(evalClaude({ state: claudeState({ weeklyAgeH: 11 }) }).rule('R3').pass, true)
  assert.equal(evalClaude({ state: claudeState({ weeklyAgeH: 12 }) }).rule('R3').pass, true)
})
test('R3 fails with a weekly reading 13 h old', () => {
  const { rule } = evalClaude({ state: claudeState({ weeklyAgeH: 13 }) })
  assert.equal(rule('R3').pass, false)
  assert.match(rule('R3').detail, /older than 12 h/)
})
test('R3 fails with a null weekly stamp (never confirmed)', () => {
  const { rule, svc } = evalClaude({ state: claudeState({ weeklyAgeH: null }) })
  assert.equal(rule('R3').pass, false)
  assert.match(rule('R3').detail, /never/i)
  assert.equal(svc.inputs.weeklyAgeHours, null)
})
test('R3 fails with an unparseable or future stamp', () => {
  const state = claudeState()
  state.claude.__ts_weekly = 'yesterday'
  assert.equal(evalClaude({ state }).rule('R3').pass, false)
  const future = claudeState()
  future.claude.__ts_weekly = new Date(NOW.getTime() + 3 * HOUR).toISOString()
  assert.equal(evalClaude({ state: future }).rule('R3').pass, false)
})

// R4
test('R4 passes when remaining equals reserve + cost (60 = 20 + 8 + 32 margin, then exactly 28)', () => {
  assert.equal(evalClaude().rule('R4').pass, true)
  // remaining 28 = reserve 20 + medium 8
  assert.equal(evalClaude({ state: claudeState({ weeklyConsumed: 72 }) }).rule('R4').pass, true)
})
test('R4 fails just below reserve + cost', () => {
  const { rule, svc } = evalClaude({ state: claudeState({ weeklyConsumed: 72.5 }) })
  assert.equal(rule('R4').pass, false)
  assert.equal(svc.eligible, false)
  assert.match(rule('R4').detail, /27\.5/)
})
test('R4 is true when at least one idea fits even if a bigger one does not', () => {
  const ideas = [idea({ id: 'big', size: 'large' }), idea({ id: 'small', size: 'small' })]
  const { rule, svc } = evalClaude({ state: claudeState({ weeklyConsumed: 72 }), ideas })
  assert.equal(rule('R4').pass, true)
  assert.equal(svc.candidate.ideaId, 'small')
  assert.deepEqual(svc.skipped.find((s) => s.ideaId === 'big').reason, 'insufficient_weekly_room')
})

// R5
test('R5 passes with a session reading 4 h old and with 30% remaining', () => {
  assert.equal(evalClaude({ state: claudeState({ sessionAgeH: 4 }) }).rule('R5').pass, true)
  assert.equal(evalClaude({ state: claudeState({ sessionConsumed: 70 }) }).rule('R5').pass, true)
})
test('R5 fails with a session reading 6 h old', () => {
  const { rule } = evalClaude({ state: claudeState({ sessionAgeH: 6 }) })
  assert.equal(rule('R5').pass, false)
  assert.match(rule('R5').detail, /older than 5 h/)
})
test('R5 fails with 29% session remaining', () => {
  const { rule } = evalClaude({ state: claudeState({ sessionConsumed: 71 }) })
  assert.equal(rule('R5').pass, false)
  assert.match(rule('R5').detail, /29%/)
})
test('R5 fails with a null session stamp', () => {
  assert.equal(evalClaude({ state: claudeState({ sessionAgeH: null }) }).rule('R5').pass, false)
})

// R6
test('R6 passes with no protected hours and with protected hours starting after the run', () => {
  assert.equal(evalClaude().rule('R6').pass, true)
  const later = policyWith({}, { protectedHours: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '14:00', end: '15:00' }] })
  assert.equal(evalClaude({ policy: later }).rule('R6').pass, true)
})
test('R6 fails when the run would reach protected hours', () => {
  const soon = policyWith({}, { protectedHours: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '12:30', end: '13:30' }] })
  const { rule } = evalClaude({ policy: soon })
  assert.equal(rule('R6').pass, false)
  assert.match(rule('R6').detail, /protected hours/i)
})
test('R6 fails when already inside protected hours', () => {
  const inside = policyWith({}, { protectedHours: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '13:00' }] })
  assert.equal(evalClaude({ policy: inside }).rule('R6').pass, false)
})
test('R6 fails when the run would reach the start of the reset day', () => {
  const now = new Date(2026, 10, 4, 23, 30) // reset day starts at 00:00, the run needs 60 min
  const { rule } = evalClaude({ now, state: claudeState({ now, daysToReset: 1 }) })
  assert.equal(rule('R6').pass, false)
  assert.match(rule('R6').detail, /reset day/i)
})
test('R6 explains an overdue reset date instead of saying a run would reach it', () => {
  const now = new Date(2026, 10, 4, 12, 0)
  const { rule } = evalClaude({ now, state: claudeState({ now, daysToReset: -3 }) })
  assert.equal(rule('R6').pass, false)
  assert.match(rule('R6').detail, /already started: update the reset date/)
  assert.doesNotMatch(rule('R6').detail, /would reach the reset day/)
})
test('R6 passes when the run ends strictly before the reset day', () => {
  const now = new Date(2026, 10, 4, 22, 59) // ends 23:59
  const { rule } = evalClaude({ now, state: claudeState({ now, daysToReset: 1 }) })
  assert.equal(rule('R6').pass, true)
})
test('R6 honours thresholds.maxRunMinutes', () => {
  const policy = policyWith()
  policy.thresholds = { ...policy.thresholds, maxRunMinutes: 120 }
  const soon = { ...policy, protectedHours: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '13:30', end: '14:30' }] }
  assert.equal(evalClaude({ policy: soon }).rule('R6').pass, false)
})

// R7
test('R7 passes with one waiting idea', () => {
  assert.equal(evalClaude().rule('R7').pass, true)
})
test('R7 fails without a waiting idea', () => {
  for (const ideas of [[], [idea({ status: 'completed' }), idea({ id: 'i2', status: 'archived' })]]) {
    const { rule, svc } = evalClaude({ ideas })
    assert.equal(rule('R7').pass, false)
    assert.match(rule('R7').detail, /no waiting idea/i)
    assert.equal(svc.eligible, false)
  }
})
test('R7 fails when the only waiting idea fails the folder check', () => {
  const { rule } = evalClaude({ folderChecks: { i1: { ok: false, code: 'folder_not_found' } } })
  assert.equal(rule('R7').pass, false)
})

test('a service passes only when all seven rules pass', () => {
  const { svc } = evalClaude()
  assert.ok(svc.rules.every((r) => r.pass))
  assert.equal(svc.eligible, true)
  assert.equal(svc.candidate.ideaId, 'i1')
  assert.equal(svc.candidate.size, 'medium')
  assert.equal(svc.candidate.costPct, 8)
  assert.ok(svc.candidate.reason.length > 0)
})
