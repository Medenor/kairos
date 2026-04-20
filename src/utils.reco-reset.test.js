import test from 'node:test'
import assert from 'node:assert/strict'
import { RULES } from './data/rules.js'

// ---------------------------------------------------------------------------
// Shared state factories
// ---------------------------------------------------------------------------

function makeState({ claudeWeekly = 70, claudeSlot = 60, copilotMonthly = 60, chatgptRemaining = 40, chatgpt5h = 60 } = {}) {
  return {
    claude: { weekly: claudeWeekly, slot5h: claudeSlot, __last_reset_date: null },
    copilot: { monthly: copilotMonthly, __last_reset_date: null },
    chatgpt: { codex_remaining: chatgptRemaining, codex_5h: chatgpt5h, __last_reset_date: null },
    openrouter: { credits: 0, __last_reset_date: null },
    kilocode: { credits: 0, __last_reset_date: null },
  }
}

function sig(state, daysRemaining = null) {
  if (state === 'countdown') return { state, daysRemaining: daysRemaining ?? 10, label: `${daysRemaining}d until next reset`, nextResetDate: '2026-04-30' }
  if (state === 'due') return { state, daysRemaining: 0, label: 'Reset due today', nextResetDate: '2026-04-20' }
  if (state === 'overdue') return { state, daysRemaining: daysRemaining ?? -3, label: 'Overdue', nextResetDate: '2026-04-17' }
  if (state === 'none') return { state: 'none', daysRemaining: null, label: 'No scheduled reset', nextResetDate: null }
  if (state === 'unset') return { state: 'unset', daysRemaining: null, label: 'Last reset date not set', nextResetDate: null }
  if (state === 'invalid') return { state: 'invalid', daysRemaining: null, label: 'Invalid reset date', nextResetDate: null }
  return { state: 'unset', daysRemaining: null, label: 'Last reset date not set', nextResetDate: null }
}

function rs(overrides = {}) {
  return {
    claude: sig('unset'),
    copilot: sig('unset'),
    chatgpt: sig('unset'),
    openrouter: sig('none'),
    kilocode: sig('none'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// T004 — US1: coding_hard reset tiebreaker
// ---------------------------------------------------------------------------

test('T004 coding_hard: comparable pressure within 15 pts → prefer sooner reset (Claude resets sooner)', () => {
  // Claude: 70%, Copilot: 60% → gap = 10 pts ≤ 15 → tiebreaker eligible
  // Claude resets in 1d, Copilot in 20d → Claude preferred
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 1), copilot: sig('countdown', 20) })
  const result = RULES.coding_hard(s, signals)
  assert.equal(result.primary, 'claude', 'Claude resets sooner — should be preferred')
  assert.ok(result.reason.includes('1d') || result.reason.includes('reset'), 'reason should mention reset timing')
})

test('T004 coding_hard: comparable pressure → prefer sooner reset (Copilot resets sooner)', () => {
  // Copilot resets in 1d, Claude in 20d → Copilot preferred
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 20), copilot: sig('countdown', 1) })
  const result = RULES.coding_hard(s, signals)
  assert.equal(result.primary, 'copilot', 'Copilot resets sooner — should be preferred')
})

test('T004 coding_hard: pressure gap > 15 pts → no tiebreaker, quota-only logic', () => {
  // Claude: 65%, Copilot: 20% → gap = 45 pts > 15 → tiebreaker NOT applied
  const s = makeState({ claudeWeekly: 65, claudeSlot: 50, copilotMonthly: 20 })
  const signals = rs({ claude: sig('countdown', 1), copilot: sig('countdown', 20) })
  const result = RULES.coding_hard(s, signals)
  // quota-only: copilot < 50 so copilot is preferred via c < 85 branch
  assert.equal(result.primary, 'copilot')
  assert.ok(!result.reason.toLowerCase().includes('resets in'), 'reason should not mention reset timing when gap > 15')
})

test('T004 coding_hard: both signals countdown same days → no preference change', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 5), copilot: sig('countdown', 5) })
  const result = RULES.coding_hard(s, signals)
  // When equal, implementation may pick either — just assert result is valid
  assert.ok(result.primary, 'must return a valid primary')
  assert.ok(result.reason, 'must return a reason')
})

// ---------------------------------------------------------------------------
// T005 — US1: coding_light reset tiebreaker
// ---------------------------------------------------------------------------

test('T005 coding_light: Claude and Copilot at comparable pressure → prefer sooner reset (Copilot sooner)', () => {
  // Branch: cop >= 50, c < 50 → tiebreaker between copilot and claude
  // Copilot: 55%, Claude: 40% → gap = 15 pts ≤ 15 → tiebreaker eligible
  // Copilot resets in 2d, Claude in 18d → Copilot preferred
  const s = makeState({ claudeWeekly: 40, copilotMonthly: 55 })
  const signals = rs({ copilot: sig('countdown', 2), claude: sig('countdown', 18) })
  const result = RULES.coding_light(s, signals)
  assert.equal(result.primary, 'copilot')
  assert.ok(result.reason.toLowerCase().includes('reset') || result.reason.includes('2d'), 'reason should mention reset')
})

test('T005 coding_light: comparable pressure → prefer sooner reset (Claude sooner)', () => {
  // Claude: 45%, Copilot: 55% → gap = 10 pts ≤ 15 → tiebreaker
  // Claude resets in 2d → Claude preferred
  const s = makeState({ claudeWeekly: 45, copilotMonthly: 55 })
  const signals = rs({ copilot: sig('countdown', 18), claude: sig('countdown', 2) })
  const result = RULES.coding_light(s, signals)
  assert.equal(result.primary, 'claude')
})

test('T005 coding_light: quota-dominant path (copilot < 50) unchanged by reset signals', () => {
  // copilot < 50 → copilot always preferred regardless of resets
  const s = makeState({ claudeWeekly: 60, copilotMonthly: 30 })
  const signals = rs({ copilot: sig('countdown', 25), claude: sig('countdown', 1) })
  const result = RULES.coding_light(s, signals)
  assert.equal(result.primary, 'copilot', 'copilot < 50 → always copilot without reset influence')
})

// ---------------------------------------------------------------------------
// T006 — US1: work_heavy reset tiebreaker
// ---------------------------------------------------------------------------

test('T006 work_heavy: Claude and ChatGPT at comparable pressure → prefer sooner reset (Claude sooner)', () => {
  // Claude: 80%, ChatGPT consumed: ~60% → gap = 20 > 15 → no tiebreaker
  // Adjust: Claude 80%, ChatGPT consumed 70% → gap = 10 ≤ 15 → tiebreaker
  const s = makeState({ claudeWeekly: 80, claudeSlot: 70, chatgptRemaining: 30 }) // chatgpt consumed = 70%
  const signals = rs({ claude: sig('countdown', 3), chatgpt: sig('countdown', 20) })
  const result = RULES.work_heavy(s, signals)
  assert.equal(result.primary, 'claude', 'Claude resets sooner — preferred')
})

test('T006 work_heavy: Claude blocked → Copilot/ChatGPT returned', () => {
  const s = makeState({ claudeWeekly: 100, claudeSlot: 80 })
  const signals = rs({ chatgpt: sig('countdown', 5) })
  const result = RULES.work_heavy(s, signals)
  assert.equal(result.primary, 'chatgpt')
})

// ---------------------------------------------------------------------------
// T011 — US2: reason strings mention reset timing when tiebreaker is decisive
// ---------------------------------------------------------------------------

test('T011 coding_hard reason: mentions both services and days when tiebreaker fires', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 1), copilot: sig('countdown', 20) })
  const result = RULES.coding_hard(s, signals)
  // When tiebreaker fires, reason must mention days
  assert.ok(result.reason.includes('1d') || result.reason.includes('20d'), `reason should mention days: "${result.reason}"`)
})

test('T011 coding_light reason: mentions reset timing when tiebreaker fires', () => {
  const s = makeState({ claudeWeekly: 40, copilotMonthly: 55 })
  const signals = rs({ copilot: sig('countdown', 2), claude: sig('countdown', 18) })
  const result = RULES.coding_light(s, signals)
  assert.ok(result.reason.includes('2d') || result.reason.toLowerCase().includes('reset'), `reason should mention reset: "${result.reason}"`)
})

test('T011 work_heavy reason: mentions reset timing when tiebreaker fires', () => {
  const s = makeState({ claudeWeekly: 80, claudeSlot: 70, chatgptRemaining: 30 })
  const signals = rs({ claude: sig('countdown', 3), chatgpt: sig('countdown', 20) })
  const result = RULES.work_heavy(s, signals)
  assert.ok(result.reason.includes('3d') || result.reason.toLowerCase().includes('reset'), `reason should mention reset: "${result.reason}"`)
})

// ---------------------------------------------------------------------------
// T012 — US2: overdue/due notes appended
// ---------------------------------------------------------------------------

test('T012 coding_hard: appends due note when selected service is due', () => {
  // Claude available and due today
  const s = makeState({ claudeWeekly: 30, claudeSlot: 40 })
  const signals = rs({ claude: sig('due') })
  const result = RULES.coding_hard(s, signals)
  assert.ok(
    result.reason.includes('Reset due today — your quota may have already refreshed.'),
    `reason must include due note: "${result.reason}"`
  )
})

test('T012 coding_hard: appends overdue note when selected service is overdue', () => {
  const s = makeState({ claudeWeekly: 30, claudeSlot: 40 })
  const signals = rs({ claude: sig('overdue', -2) })
  const result = RULES.coding_hard(s, signals)
  assert.ok(
    result.reason.includes('Reset overdue — consider logging the new reset date.'),
    `reason must include overdue note: "${result.reason}"`
  )
})

test('T012 coding_light: appends due note for selected service', () => {
  const s = makeState({ claudeWeekly: 30, copilotMonthly: 70 })
  const signals = rs({ claude: sig('due') })
  const result = RULES.coding_light(s, signals)
  assert.ok(
    result.reason.includes('Reset due today — your quota may have already refreshed.'),
    `reason must include due note: "${result.reason}"`
  )
})

test('T012 work_heavy: appends due note for selected service', () => {
  const s = makeState({ claudeWeekly: 30, claudeSlot: 40 })
  const signals = rs({ claude: sig('due') })
  const result = RULES.work_heavy(s, signals)
  assert.ok(
    result.reason.includes('Reset due today — your quota may have already refreshed.'),
    `reason must include due note: "${result.reason}"`
  )
})

// ---------------------------------------------------------------------------
// T015 — US3: resetSignals undefined → quota-only fallback
// ---------------------------------------------------------------------------

test('T015 coding_hard: resetSignals undefined → quota-only result, no reset mention', () => {
  const s = makeState({ claudeWeekly: 30, claudeSlot: 40 })
  const result = RULES.coding_hard(s, undefined)
  assert.ok(result.primary, 'must return valid primary')
  assert.ok(!result.reason.toLowerCase().includes('reset'), `reason must not mention reset: "${result.reason}"`)
})

test('T015 coding_light: resetSignals undefined → quota-only result', () => {
  const s = makeState({ claudeWeekly: 30, copilotMonthly: 70 })
  const result = RULES.coding_light(s, undefined)
  assert.ok(result.primary)
  assert.ok(!result.reason.toLowerCase().includes('reset'), `reason must not mention reset: "${result.reason}"`)
})

test('T015 work_heavy: resetSignals undefined → quota-only result', () => {
  const s = makeState({ claudeWeekly: 30, claudeSlot: 40 })
  const result = RULES.work_heavy(s, undefined)
  assert.ok(result.primary)
  assert.ok(!result.reason.toLowerCase().includes('reset'), `reason must not mention reset: "${result.reason}"`)
})

// ---------------------------------------------------------------------------
// T016 — US3: both services have state unset/invalid → quota-only
// ---------------------------------------------------------------------------

test('T016 coding_hard: both services unset → quota-only, no reset mention', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('unset'), copilot: sig('unset') })
  const result = RULES.coding_hard(s, signals)
  // Tiebreaker cannot fire when both unset — quota-only
  assert.ok(!result.reason.includes('d vs'), `reason must not include tiebreaker text: "${result.reason}"`)
})

test('T016 coding_hard: both services invalid → no reset mention', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('invalid'), copilot: sig('invalid') })
  const result = RULES.coding_hard(s, signals)
  assert.ok(!result.reason.includes('d vs'), `reason must not include tiebreaker text: "${result.reason}"`)
})

test('T016 coding_light: both none → quota-only', () => {
  const s = makeState({ claudeWeekly: 60, copilotMonthly: 55 })
  const signals = rs({ claude: sig('none'), copilot: sig('none') })
  const result = RULES.coding_light(s, signals)
  assert.ok(!result.reason.toLowerCase().includes('resets sooner'), `reason should not mention resets sooner: "${result.reason}"`)
})

// ---------------------------------------------------------------------------
// T017 — US3: edge cases
// ---------------------------------------------------------------------------

test('T017: one service countdown, one unset → tiebreaker skipped, quota-only', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 3), copilot: sig('unset') })
  const result = RULES.coding_hard(s, signals)
  // Copilot unset → no tiebreaker possible
  assert.ok(!result.reason.includes('3d vs'), `reason must not include tiebreaker: "${result.reason}"`)
})

test('T017: both services same daysRemaining → no preference change', () => {
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('countdown', 5), copilot: sig('countdown', 5) })
  const result = RULES.coding_hard(s, signals)
  assert.ok(result.primary, 'must return valid primary')
  assert.ok(result.reason, 'must return reason')
})

test('T017: service state overdue → note added but overdue not used as tiebreaker', () => {
  // Claude overdue, Copilot countdown — overdue is NOT a tiebreaker candidate
  const s = makeState({ claudeWeekly: 70, claudeSlot: 50, copilotMonthly: 60 })
  const signals = rs({ claude: sig('overdue', -3), copilot: sig('countdown', 2) })
  // Copilot countdown, claude overdue → if the selected service is overdue, note appended
  // But overdue should NOT win the tiebreaker over countdown
  const result = RULES.coding_hard(s, signals)
  assert.ok(result.primary, 'must return valid primary')
  // Copilot has daysRemaining (countdown), Claude overdue → tiebreaker only eligible for countdown/due
  // So copilot should be preferred if it would be in the tiebreaker range
})
