# Contract: Recommendation Rule Interface (Reset-Aware)

**Feature**: 004-reset-aware-recommendations  
**Date**: 2026-04-20  
**Scope**: `src/data/rules.js` — public interface consumed by `src/components/RecoBox.jsx`

---

## Overview

This contract documents the calling convention and return shape of the `RULES` object after the reset-aware augmentation. It governs:

1. The **input signature** of rule functions (quota state + optional reset signals)
2. The **output shape** of recommendation results (unchanged)
3. The **fallback guarantee** when reset data is absent

---

## Rule Function Signature

```js
/**
 * @param {QuotaStateMap} state
 *   The raw quota state keyed by service ID.
 *   Shape: { [serviceId]: { [quotaId]: number, __last_reset_date: string|null } }
 *
 * @param {ResetSignalMap} [resetSignals]
 *   Optional. Pre-computed reset timing signals keyed by service ID.
 *   Shape: { [serviceId]: { state, daysRemaining, label, nextResetDate } }
 *   If omitted or undefined, rule MUST fall back to quota-only logic.
 *
 * @returns {RecommendationRationale}
 *   { primary: string, reason: string, alts: string[] }
 */
RULES[taskId](state, resetSignals?)
```

### Caller responsibilities

- Compute `resetSignals` via `getResetSignals(state, SERVICES)` from `src/utils.js`.
- Pass `resetSignals` as the second argument to every rule call.
- Never modify the returned `RecommendationRationale` object.

### Rule responsibilities

- MUST return a valid `RecommendationRationale` for all input combinations.
- MUST fall back to quota-only logic when `resetSignals` is `undefined` or when a service's signal has state `none`, `unset`, or `invalid`.
- MUST NOT throw for any input.
- MUST remain a pure function (no side effects, no I/O, no randomness).

---

## ResetSignalMap Contract

```js
// Returned by getResetSignals(state, services) in src/utils.js
{
  claude:      { state, daysRemaining, label, nextResetDate },
  chatgpt:     { state, daysRemaining, label, nextResetDate },
  copilot:     { state, daysRemaining, label, nextResetDate },
  openrouter:  { state: 'none', daysRemaining: null, label: 'No scheduled reset', nextResetDate: null },
  kilocode:    { state: 'none', daysRemaining: null, label: 'No scheduled reset', nextResetDate: null },
}
```

**Valid states**: `'none' | 'unset' | 'invalid' | 'countdown' | 'due' | 'overdue'`

| State | `daysRemaining` | Reset tiebreaker eligible? |
|-------|-----------------|---------------------------|
| `countdown` | `> 0` | Yes — lower value preferred |
| `due` | `0` | Yes — treated as imminent, note added to reason |
| `overdue` | `< 0` | Note added to reason; not used as tiebreaker |
| `none` | `null` | No — payg services |
| `unset` | `null` | No — missing user input |
| `invalid` | `null` | No — bad or future-dated input |

---

## RecommendationRationale Contract

```js
// Returned by every RULES[taskId](state, resetSignals) call
{
  primary: string,   // service ID of the recommended service (e.g., 'claude', 'copilot')
  reason:  string,   // plain-language explanation; MUST mention reset timing when it influenced the choice
  alts:    string[], // zero or more alternative service labels
}
```

### Reason string guarantees (FR-003, FR-005)

| Situation | Guarantee |
|-----------|-----------|
| Reset timing changed the selected service | `reason` MUST state which service resets sooner and why that mattered |
| Selected service state is `due` | `reason` MUST append: `"Reset due today — your quota may have already refreshed."` |
| Selected service state is `overdue` | `reason` MUST append: `"Reset overdue — consider logging the new reset date."` |
| Reset data absent / invalid for all compared services | `reason` MUST NOT mention reset timing; quota-only reason returned unchanged |
| Reset data absent for one of two compared services | Reset tiebreaker is skipped; quota-only reason returned unchanged |

---

## Tiebreaker Algorithm Contract

Applied only when both conditions hold:

1. Two services have quota pressure within **15 percentage points** of each other at a decision branch.
2. Both services have a valid `daysRemaining` value (states `countdown` or `due`).

```
If |pressureA - pressureB| <= 15 AND both have daysRemaining != null:
  prefer service with lower daysRemaining (resets sooner)
  include reset context in reason
Else:
  use existing quota-only branch (unchanged)
```

---

## Affected Rules

| Rule ID | Augmented | Reset-relevant services |
|---------|-----------|------------------------|
| `coding_hard` | Yes | `claude` vs `copilot`, `claude` vs `chatgpt` |
| `coding_light` | Yes | `claude` vs `copilot` |
| `work_heavy` | Yes | `claude` vs `chatgpt` |
| `daily_chat` | No | n/a |
| `oneshot` | No | payg services only (`none` state) |

---

## Backward Compatibility

- All existing call sites that pass only `state` continue to work (second argument defaults to `undefined`).
- Output shape is unchanged — `{ primary, reason, alts }`.
- No existing tests are invalidated; new tests extend coverage without modifying existing assertions.
