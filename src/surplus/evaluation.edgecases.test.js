// T072: edge cases of the spec for evaluation, time and cycles (service removed or renamed, unset or
// invalid reset date, clock boundaries, DST, relative path without base folder, same folder).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSurplus } from './evaluation.js'
import { legacyPolicy as defaultPolicy } from '../providers/fixtures/legacyServices.js'
import { deriveCycleReadings } from './cycleReadings.js'
import { summariseCycles } from './cycles.js'
import { hardStopAt, isInProtectedHours, nextProtectedStart } from './time.js'
import { LEGACY_SERVICES as SERVICES } from '../providers/fixtures/legacyServices.js'

const savedTz = process.env.TZ
process.env.TZ = 'Europe/Paris'
after(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz })

const HOUR = 3600000
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lastResetFor = (now, daysToReset) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToReset - 7))

function claudeState(now, { daysToReset = 2, lastReset, extra = {} } = {}) {
  return {
    claude: {
      weekly: 40,
      slot5h: 40,
      __last_reset_date: lastReset !== undefined ? lastReset : lastResetFor(now, daysToReset),
      __ts_weekly: new Date(now.getTime() - HOUR).toISOString(),
      __ts_slot5h: new Date(now.getTime() - HOUR).toISOString(),
      ...extra,
    },
  }
}

function policyWith(extra = {}) {
  const p = defaultPolicy()
  p.providers.claude = { ...p.providers.claude, surplusEnabled: true }
  return { ...p, ...extra }
}

const idea = (over = {}) => ({
  id: 'i1', text: 'Write the tests', context: '', workingFolder: null, priority: 'normal', size: 'medium',
  status: 'waiting', createdAt: '2026-11-01T08:00:00.000Z', ...over,
})

const NOON = new Date(2026, 10, 3, 12, 0)

function run(over = {}) {
  const now = over.now ?? NOON
  return evaluateSurplus({
    now, state: claudeState(now), services: SERVICES, policy: policyWith(), ideas: [idea()], runs: [], folderChecks: null, mode: 'preview', ...over,
  })
}
const claudeOf = (evaluation) => evaluation.services.find((s) => s.serviceId === 'claude')

// --- service renamed, hidden or removed -------------------------------------------------------------

test('a service removed from the list is simply not evaluated, and the others still are', () => {
  const evaluation = run({ services: SERVICES.filter((s) => s.id !== 'chatgpt') })
  assert.deepEqual(evaluation.services.map((s) => s.serviceId), ['claude'])
  assert.equal(evaluation.selected.serviceId, 'claude')
})

test('no surplus-capable service at all gives a reason, not a crash', () => {
  for (const services of [[], undefined, null, SERVICES.filter((s) => !s.surplus)]) {
    const evaluation = run({ services })
    assert.equal(evaluation.selected, null)
    assert.ok(evaluation.reason.length > 0)
  }
})

test('a renamed service shows its new name in the reason and keeps the same decision', () => {
  const renamed = SERVICES.map((s) => (s.id === 'claude' ? { ...s, name: 'Claude Pro (renamed)' } : s))
  const before = claudeOf(run())
  const after = claudeOf(run({ services: renamed }))
  assert.match(after.reason, /^Claude Pro \(renamed\)/)
  assert.equal(after.eligible, before.eligible)
  assert.deepEqual(after.rules, before.rules)
})

test('a service whose quota ids were renamed is not eligible, with reasons, and does not throw', () => {
  const broken = SERVICES.map((s) => (s.id === 'claude' ? { ...s, surplus: { ...s.surplus, weeklyQuotaId: 'weekly_v2', sessionQuotaId: 'slot_v2' } } : s))
  const svc = claudeOf(run({ services: broken }))
  assert.equal(svc.eligible, false)
  assert.equal(svc.inputs.weeklyRemainingPct, null)
  assert.ok(svc.rules.filter((r) => !r.pass).every((r) => r.detail.length > 0))
})

test('policy and records naming unknown services are ignored', () => {
  const policy = policyWith()
  policy.providers.gone = { surplusEnabled: true, reservePct: 20, windowDays: 2, autoRunEnabled: true, disclosuresAckAt: null }
  const runs = [{ id: 'r', ideaId: 'x', serviceId: 'gone', status: 'running', cycleKey: 'gone:2026-11-05', ideaSnapshot: null }]
  const ideas = [idea(), idea({ id: 'i2', status: 'running', serviceId: 'gone', lastRunId: 'missing' })]
  const evaluation = run({ policy, runs, ideas })
  assert.deepEqual(evaluation.services.map((s) => s.serviceId), ['claude', 'chatgpt'])
  assert.equal(claudeOf(evaluation).eligible, true)
})

test('a policy without the service entry fails R1 only', () => {
  const policy = policyWith()
  delete policy.providers.claude
  const svc = claudeOf(run({ policy }))
  assert.equal(svc.rules[0].id, 'R1')
  assert.equal(svc.rules[0].pass, false)
  assert.equal(svc.eligible, false)
})

test('null or garbage entries in ideas, runs and state never throw', () => {
  const evaluation = run({ ideas: [null, undefined, 3, 'x', idea()], runs: [null, {}, { status: 'running' }, 7], state: null })
  assert.ok(evaluation.reason.length > 0)
  const again = run({ ideas: 'nope', runs: { a: 1 }, state: { claude: 'x' }, policy: null })
  assert.equal(again.selected, null)
})

test('deriveCycleReadings and summariseCycles ignore a service that is no longer listed', () => {
  const state = claudeState(NOON)
  const { readings, stamps } = deriveCycleReadings(null, state, SERVICES.filter((s) => s.id !== 'claude'), NOON)
  assert.deepEqual(readings, [])
  assert.deepEqual(stamps, {})
  const cycles = [{ serviceId: 'claude', resetDate: '2026-11-01', lastWeeklyRemainingPct: 30, readAt: '2026-10-31T10:00:00.000Z' }]
  assert.equal(summariseCycles({ cycles, runs: [], serviceId: 'removed', now: NOON }).status, 'history_too_short')
  assert.equal(summariseCycles({ cycles, runs: [], serviceId: 'claude', now: NOON }).status, 'ok')
})

// --- reset date unset or invalid --------------------------------------------------------------------

for (const [name, lastReset, expectedState] of [
  ['unset', null, 'unset'],
  ['empty string', '', 'unset'],
  ['not a date', 'tomorrow', 'invalid'],
  ['impossible date', '2026-02-31', 'invalid'],
  ['in the future', '2026-12-25', 'invalid'],
]) {
  test(`reset date ${name}: not eligible, R2 fails with a reason, nothing selected`, () => {
    const evaluation = run({ state: claudeState(NOON, { lastReset }) })
    const svc = claudeOf(evaluation)
    assert.equal(svc.inputs.resetState, expectedState)
    assert.equal(svc.eligible, false)
    const r2 = svc.rules.find((r) => r.id === 'R2')
    assert.equal(r2.pass, false)
    assert.ok(r2.detail.length > 0)
    assert.equal(evaluation.selected, null)
  })
}

test('an impossible last reset date is never rolled over into a real one (2026-02-31 is not March 3)', () => {
  // Rolled over, 2026-02-31 would be 2026-03-03, so the next reset 2026-03-10 would be 2 days from 2026-03-08.
  const now = new Date(2026, 2, 8, 12, 0)
  const evaluation = run({ now, state: claudeState(now, { lastReset: '2026-02-31' }) })
  assert.equal(claudeOf(evaluation).inputs.resetState, 'invalid')
  assert.equal(claudeOf(evaluation).eligible, false)
  assert.equal(evaluation.selected, null)
})

test('the reset day itself (due today) and an overdue reset are not eligible', () => {
  const due = claudeOf(run({ state: claudeState(NOON, { daysToReset: 0 }) }))
  assert.equal(due.rules.find((r) => r.id === 'R2').pass, false)
  const overdue = claudeOf(run({ state: claudeState(NOON, { daysToReset: -3 }) }))
  assert.equal(overdue.rules.find((r) => r.id === 'R2').pass, false)
})

// --- clock boundaries -------------------------------------------------------------------------------

test('R6 at midnight: a run ending exactly at the start of the reset day does not pass, a minute earlier does', () => {
  const state = (now) => claudeState(now, { daysToReset: 1 })
  const exactly = new Date(2026, 10, 3, 23, 0)
  const earlier = new Date(2026, 10, 3, 22, 59)
  assert.equal(claudeOf(run({ now: exactly, state: state(exactly) })).rules.find((r) => r.id === 'R6').pass, false)
  assert.equal(claudeOf(run({ now: earlier, state: state(earlier) })).rules.find((r) => r.id === 'R6').pass, true)
})

test('near local midnight the day count of the evaluation is the local calendar day', () => {
  const lateNight = new Date(2026, 10, 3, 23, 59)
  const justAfter = new Date(2026, 10, 4, 0, 1)
  const reset = '2026-10-29' // next reset 2026-11-05
  assert.equal(claudeOf(run({ now: lateNight, state: claudeState(lateNight, { lastReset: reset }) })).inputs.daysToReset, 2)
  assert.equal(claudeOf(run({ now: justAfter, state: claudeState(justAfter, { lastReset: reset }) })).inputs.daysToReset, 1)
})

test('protected hours: a run ending exactly at the start fails, one ending a minute before passes, and the end instant is free', () => {
  const policy = policyWith({ protectedHours: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '20:00' }] })
  const r6 = (now) => claudeOf(run({ now, policy, state: claudeState(now) })).rules.find((r) => r.id === 'R6').pass
  assert.equal(r6(new Date(2026, 10, 3, 17, 0)), false)
  assert.equal(r6(new Date(2026, 10, 3, 16, 59)), true)
  assert.equal(r6(new Date(2026, 10, 3, 19, 59)), false)
  assert.equal(r6(new Date(2026, 10, 3, 20, 0)), true) // protected range is [start, end)
})

test('protected hours across midnight guard both sides of midnight', () => {
  const ranges = [{ days: [2], start: '22:00', end: '06:00' }] // Tuesday evening to Wednesday morning
  assert.equal(isInProtectedHours(ranges, new Date(2026, 10, 3, 23, 30)), true)
  assert.equal(isInProtectedHours(ranges, new Date(2026, 10, 4, 5, 59)), true)
  assert.equal(isInProtectedHours(ranges, new Date(2026, 10, 4, 6, 0)), false)
  assert.equal(isInProtectedHours(ranges, new Date(2026, 10, 3, 5, 59)), false, 'Tuesday morning belongs to Monday night')
  assert.equal(nextProtectedStart(ranges, new Date(2026, 10, 4, 7, 0)).getDate(), 10, 'next Tuesday')
})

test('DST spring forward: a protected start in the skipped hour lands on a real instant after now', () => {
  // 2026-03-29 02:00 to 03:00 does not exist in Europe/Paris.
  const ranges = [{ days: [0], start: '02:30', end: '06:00' }]
  const now = new Date(2026, 2, 28, 23, 0)
  const start = nextProtectedStart(ranges, now)
  assert.ok(start instanceof Date && !Number.isNaN(start.getTime()))
  assert.ok(start > now)
  assert.ok(start.getTime() - now.getTime() <= 4 * HOUR, 'within the following night')
  assert.equal(hardStopAt(now, { protectedHours: ranges, thresholds: { maxRunMinutes: 600 } }, null).getTime(), start.getTime())
})

test('DST fall back: a night range crossing the 25-hour night stays protected until its end', () => {
  const ranges = [{ days: [0], start: '22:00', end: '06:00' }] // Sunday 2026-10-25 22:00 to Monday 06:00 (fall back at 03:00)
  assert.equal(isInProtectedHours(ranges, new Date(2026, 9, 26, 5, 59)), true)
  assert.equal(isInProtectedHours(ranges, new Date(2026, 9, 26, 6, 0)), false)
  assert.equal(isInProtectedHours([{ days: [6], start: '22:00', end: '06:00' }], new Date(2026, 9, 25, 1, 30)), true)
})

test('a malformed protected range never throws and never protects', () => {
  const bad = [{ days: 'all', start: '8am', end: null }, null, { days: [1], start: '25:00', end: '26:00' }, 'x']
  assert.equal(isInProtectedHours(bad, NOON), false)
  assert.equal(nextProtectedStart(bad, NOON), null)
})

// --- relative path without base folder, same folder -------------------------------------------------

test('a relative folder with no base folder is skipped as folder_missing_base by the runner check', () => {
  const folderChecks = { i1: { ok: false, code: 'folder_missing_base' } }
  const svc = claudeOf(run({ mode: 'auto', ideas: [idea({ workingFolder: 'proj' })], folderChecks }))
  assert.equal(svc.eligible, false)
  assert.equal(svc.skipped[0].reason, 'folder_missing_base')
  assert.match(svc.rules.find((r) => r.id === 'R7').detail, /folder_missing_base/)
})

test('in the browser a relative folder without base folder is not blocked, since the runner device checks it (FR-027)', () => {
  const svc = claudeOf(run({ ideas: [idea({ workingFolder: 'proj' })] }))
  assert.equal(svc.eligible, true)
})

test('two ideas on one folder written differently count as the same folder while one runs', () => {
  const policy = policyWith({ projectsBaseFolder: '/work' })
  const running = idea({ id: 'a', status: 'running', workingFolder: '/work/proj', lastRunId: 'r1' })
  const waiting = [
    idea({ id: 'b', workingFolder: 'proj' }),
    idea({ id: 'c', workingFolder: 'proj/' }),
    idea({ id: 'd', workingFolder: '/work//proj/./' }),
    idea({ id: 'e', workingFolder: 'other' }),
  ]
  const svc = claudeOf(run({ policy, ideas: [running, ...waiting], runs: [] }))
  assert.deepEqual(svc.skipped.filter((s) => s.reason === 'running_elsewhere').map((s) => s.ideaId).sort(), ['b', 'c', 'd'])
  assert.equal(svc.candidate.ideaId, 'e')
})

// FR-017: an idea without a working folder runs in its own empty scratch directory.
test('a folder-less idea passes the runner folder check and is selected, not skipped for folder reasons', () => {
  const folderChecks = { i1: { ok: true, resolvedFolder: null, scratch: true, fileCount: 0, sizeBytes: 0 } }
  const evaluation = run({ mode: 'auto', ideas: [idea({ workingFolder: null })], folderChecks })
  const svc = claudeOf(evaluation)
  assert.equal(svc.eligible, true)
  assert.deepEqual(svc.skipped, [])
  assert.equal(evaluation.selected.ideaId, 'i1')
})

test('two folder-less ideas never conflict on a folder, whether or not one of them is running', () => {
  const runningRun = {
    id: 'r1', ideaId: 'a', serviceId: 'claude', status: 'running',
    ideaSnapshot: { text: 't', context: '', workingFolder: null, resolvedFolder: null, contentVersion: 1 },
  }
  const folderChecks = {
    b: { ok: true, resolvedFolder: null, scratch: true }, c: { ok: true, resolvedFolder: null, scratch: true },
  }
  const ideas = [
    idea({ id: 'a', status: 'running', workingFolder: null, lastRunId: 'r1' }),
    idea({ id: 'b', workingFolder: '' }),
    idea({ id: 'c', workingFolder: '   ', priority: 'high' }),
  ]
  for (const mode of ['auto', 'preview']) {
    const svc = claudeOf(run({ mode, ideas, runs: [runningRun], folderChecks: mode === 'auto' ? folderChecks : null }))
    assert.deepEqual(svc.skipped.filter((s) => s.reason === 'running_elsewhere'), [], mode)
    assert.equal(svc.candidate.ideaId, 'c', mode)
  }
})

test('a folder-less idea does not block an idea that has a folder, and the reverse', () => {
  const runningRun = {
    id: 'r1', ideaId: 'a', serviceId: 'claude', status: 'running',
    ideaSnapshot: { text: 't', context: '', workingFolder: '/work/proj', resolvedFolder: '/work/proj', contentVersion: 1 },
  }
  const svc = claudeOf(run({ ideas: [idea({ id: 'a', status: 'running', workingFolder: '/work/proj', lastRunId: 'r1' }), idea({ id: 'b', workingFolder: null })], runs: [runningRun] }))
  assert.equal(svc.candidate.ideaId, 'b')
})

test('evaluation does not mutate its inputs and is deterministic across a service list change', () => {
  const ideas = [idea(), idea({ id: 'i2', priority: 'high' })]
  const snapshot = JSON.stringify(ideas)
  const a = run({ ideas })
  const b = run({ ideas })
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(ideas), snapshot)
})
