# Quickstart: reset-aware-recommendations

**Feature**: 004-reset-aware-recommendations  
**Date**: 2026-04-20  
**Branch**: `004-reset-aware-recommendations`

---

## What this feature adds

Routing recommendations now factor in each service's scheduled reset timing. When two services have comparable quota pressure, the one resetting sooner is preferred — its quota will refresh faster, so spending it now costs less in the long run. Reason text is updated to explain when and how reset timing influenced the choice.

---

## Key files to change

| File | Change |
|------|--------|
| `src/utils.js` | Add `getResetSignals(state, services)` export |
| `src/data/rules.js` | Add `resetSignals` second param; update `coding_hard`, `coding_light`, `work_heavy` |
| `src/components/RecoBox.jsx` | Compute `resetSignals` and pass to rule |
| `src/utils.reco-reset.test.js` | New test file with scenario-based fixtures |

---

## Step 1 — Add `getResetSignals` to `src/utils.js`

Add after the existing `getResetInfo` export:

```js
// Returns a map of reset timing signals for all services.
// Pure function — no side effects.
export function getResetSignals(state, services) {
  const signals = {}
  for (const svc of services) {
    signals[svc.id] = getResetInfo(
      state[svc.id]?.[RESET_DATE_KEY] ?? null,
      svc.resetCycleDays
    )
  }
  return signals
}
```

---

## Step 2 — Update `src/data/rules.js`

### Add a reset-aware tiebreaker helper at the top of the file:

```js
// Returns true when both services have a valid daysRemaining and their
// quota pressures are within the comparable-pressure band (15 pts).
function resetTiebreaker(sigA, sigB, pressureA, pressureB) {
  if (!sigA || !sigB) return false
  if (sigA.daysRemaining === null || sigB.daysRemaining === null) return false
  return Math.abs(pressureA - pressureB) <= 15
}

// Returns a note to append when the selected service has a due/overdue reset.
function resetNote(signal) {
  if (!signal) return ''
  if (signal.state === 'due') return ' Reset due today — your quota may have already refreshed.'
  if (signal.state === 'overdue') return ' Reset overdue — consider logging the new reset date.'
  return ''
}
```

### Update `coding_hard` rule signature and add tiebreaker:

```js
// Before:
coding_hard: (s) => { ... }

// After:
coding_hard: (s, rs) => {
  // rs = resetSignals (optional, may be undefined)
  const c = s.claude.weekly
  const c5h = s.claude.slot5h

  if (claudeBlocked(s)) {
    // Reset tiebreaker: copilot vs chatgpt when both are non-payg
    const copPressure = s.copilot.monthly
    const chatPressure = 100 - s.chatgpt.codex_remaining
    if (rs && resetTiebreaker(rs.copilot, rs.chatgpt, copPressure, chatPressure)) {
      const preferCop = rs.copilot.daysRemaining <= rs.chatgpt.daysRemaining
      const primary = preferCop ? 'copilot' : 'chatgpt'
      return {
        primary,
        reason: `Claude blocked. ${preferCop ? 'Copilot' : 'ChatGPT'} resets sooner (${preferCop ? rs.copilot.daysRemaining : rs.chatgpt.daysRemaining}d) — best to spend it now.${resetNote(rs[primary])}`,
        alts: [preferCop ? 'chatgpt' : 'copilot'],
      }
    }
    return {
      primary: 'copilot',
      reason: `Claude is blocked (weekly or 5h slot limit reached). Copilot to keep coding.${resetNote(rs?.copilot)}`,
      alts: ['chatgpt (Codex if available)'],
    }
  }
  // ... rest of existing branches, adding resetNote(rs?.claude) to reason strings
  // and adding reset tiebreaker at the c < 85 branch between claude and copilot
}
```

> **Note**: The exact integration points per rule are documented in the contract (`contracts/reco-reset.md`). The implementation task will define line-level changes.

---

## Step 3 — Update `src/components/RecoBox.jsx`

```js
// Add imports at the top:
import { SERVICES } from '../data/services'
import { getResetSignals } from '../utils'

// In the component body, before calling the rule:
const resetSignals = getResetSignals(state, SERVICES)
const result = rule(state, resetSignals)
```

---

## Step 4 — Write tests in `src/utils.reco-reset.test.js`

Use the existing `src/utils.reset.test.js` as a model. Test matrix:

```
For coding_hard, coding_light, work_heavy:
  ✓ reset tiebreaker selects sooner-resetting service when pressures are comparable
  ✓ reset tiebreaker does NOT override when pressure gap > 15pts
  ✓ reason mentions reset timing when tiebreaker applies
  ✓ reason appends due note when selected service is 'due'
  ✓ reason appends overdue note when selected service is 'overdue'
  ✓ quota-only result returned when resetSignals is undefined
  ✓ quota-only result returned when both signals are 'unset'
  ✓ quota-only result returned when both signals are 'invalid'

For daily_chat, oneshot:
  ✓ result unchanged regardless of resetSignals value
```

---

## Verification checklist

Before merging, verify:

- [ ] All new tests in `src/utils.reco-reset.test.js` pass (`node --test src/utils.reco-reset.test.js`)
- [ ] All existing tests in `src/utils.reset.test.js` still pass (no regressions)
- [ ] Manual: set Claude to 70% weekly, Copilot to 60% monthly, Claude reset in 1d, Copilot reset in 20d → `coding_light` recommendation switches to Claude with reset mention
- [ ] Manual: set a service to overdue → reason for that service includes the overdue note
- [ ] Manual: clear all reset dates → recommendations still return valid results (no errors, no blank reasons)
- [ ] Manual: set both services in a comparison pair to `invalid` reset dates → quota-only reason, no reset mention
