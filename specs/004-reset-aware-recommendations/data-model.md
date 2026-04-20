# Data Model: reset-aware-recommendations

**Phase**: 1 — Design & Contracts  
**Date**: 2026-04-20  
**Branch**: `004-reset-aware-recommendations`

---

## Overview

This feature introduces no new persisted entities. It derives a computed **ResetSignalMap** from existing stored state at recommendation time and passes it alongside the existing **QuotaStateMap** into routing rule functions. The **RecommendationRationale** shape is preserved; only its string content (`reason`) is enriched when reset timing is a deciding factor.

---

## Entities

### 1. ResetTimingSignal *(derived, not persisted)*

One instance per service, computed from `getResetInfo(lastResetDate, resetCycleDays, now)`.

| Field | Type | Description |
|-------|------|-------------|
| `state` | `'none' \| 'unset' \| 'invalid' \| 'countdown' \| 'due' \| 'overdue'` | Normalized timing state for the service |
| `daysRemaining` | `number \| null` | Days until next reset (`null` for none/unset/invalid; `0` for due; negative for overdue) |
| `label` | `string` | Human-readable label (e.g., `"3d until next reset"`, `"Reset due today"`) |
| `nextResetDate` | `string \| null` | ISO 8601 date string of the projected next reset, or `null` |

**State semantics**:

| State | `daysRemaining` | Meaning |
|-------|-----------------|---------|
| `none` | `null` | Service has no scheduled reset cycle (pay-as-you-go) |
| `unset` | `null` | User has not entered a reset date yet |
| `invalid` | `null` | Stored date is malformed or future-dated |
| `countdown` | `> 0` | Reset is upcoming; N days remain |
| `due` | `0` | Reset is due today |
| `overdue` | `< 0` | Reset date has passed; quota may have refreshed |

**Validation rules**:
- `daysRemaining` MUST be `null` for states `none`, `unset`, `invalid`.
- `daysRemaining` MUST be a number for states `countdown`, `due`, `overdue`.
- `daysRemaining === 0` for state `due`.
- `daysRemaining < 0` for state `overdue`.

---

### 2. ResetSignalMap *(derived, not persisted)*

A map of all services' reset timing signals, computed once per recommendation evaluation.

```js
// Shape
{
  [serviceId: string]: ResetTimingSignal
}
```

**Computed by**: `getResetSignals(state, services)` in `src/utils.js`.

**Input**:
- `state` — the full `QuotaStateMap` from `useQuotaState` / `useSharedQuotaState`, which includes `state[serviceId][RESET_DATE_KEY]` for each service.
- `services` — the `SERVICES` array from `src/data/services.js`, providing `resetCycleDays` per service.

**Behaviour**:
- For each service in `services`, calls `getResetInfo(state[svc.id][RESET_DATE_KEY], svc.resetCycleDays)`.
- Returns a plain object keyed by `svc.id`.
- Pure function: no side effects, same inputs → same output.

---

### 3. RecommendationDecisionContext *(runtime, not persisted)*

The combined input set used inside a routing rule function.

| Parameter | Type | Description |
|-----------|------|-------------|
| `state` | `QuotaStateMap` | Raw quota values per service (existing parameter) |
| `resetSignals` | `ResetSignalMap \| undefined` | Derived reset timing signals (new optional parameter) |

**Passed as**: `RULES[task](state, resetSignals)`

**Backward compatibility**: If a caller omits `resetSignals` (or passes `undefined`), rule functions fall back to quota-only logic via a guard check (`if (!resetSignals) return quotaOnlyResult`).

---

### 4. RecommendationRationale *(runtime, unchanged shape)*

The output of a routing rule function. Shape is unchanged from the existing implementation.

| Field | Type | Description |
|-------|------|-------------|
| `primary` | `string` | ID of the recommended service |
| `reason` | `string` | Plain-language explanation of the recommendation |
| `alts` | `string[]` | Alternative service suggestions |

**Content changes** (not shape changes):
- When reset timing is the decisive tiebreaker, `reason` includes the reset context, e.g.:  
  `"Claude under pressure — but resets in 1d vs. Copilot's 14d. Spend Claude now to preserve Copilot for the month."`
- When the selected service is `due`: `reason` appends `"Reset due today — your quota may have already refreshed."`
- When the selected service is `overdue`: `reason` appends `"Reset is overdue — consider logging the new reset date."`
- When reset data is unavailable for a compared service: no reset mention; quota-only reason is returned unchanged.

---

## State Transitions — ResetTimingSignal

```
User enters a reset date
        │
        ▼
  parseISODateOnly()
  ┌───────────────────┐
  │ invalid format    │──► state: 'invalid'
  │ future-dated      │──► state: 'invalid'
  └───────────────────┘
        │ valid date
        ▼
  compare with today
  ┌──────────────────────────┐
  │ daysRemaining > 0        │──► state: 'countdown'
  │ daysRemaining === 0      │──► state: 'due'
  │ daysRemaining < 0        │──► state: 'overdue'
  └──────────────────────────┘

User has NOT entered a date ──────────────────► state: 'unset'
Service has no reset cycle (resetCycleDays=null) ► state: 'none'
```

---

## Affected Files

| File | Change Type | Description |
|------|-------------|-------------|
| `src/utils.js` | Modified | Add `getResetSignals(state, services)` export |
| `src/data/rules.js` | Modified | Add `resetSignals` second parameter to `RULES` functions; update `coding_hard`, `coding_light`, `work_heavy` |
| `src/components/RecoBox.jsx` | Modified | Import `SERVICES` and `getResetSignals`; compute signals and pass to rule |
| `src/utils.reco-reset.test.js` | New | Scenario-based unit tests using `node:test` |

No new files, no new persisted keys, no new dependencies.
