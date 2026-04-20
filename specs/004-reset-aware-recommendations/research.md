# Research: reset-aware-recommendations

**Phase**: 0 — Outline & Research  
**Date**: 2026-04-20  
**Branch**: `004-reset-aware-recommendations`

## Summary

All technical unknowns are fully resolved by the existing codebase. No external research was required. This document records the design decisions reached by analysis of `src/utils.js`, `src/data/rules.js`, `src/components/RecoBox.jsx`, and `src/data/services.js`.

---

## Decision 1 — How to expose reset signals to rule functions

- **Decision**: Add a new exported pure function `getResetSignals(state, services)` to `src/utils.js`. Pass its output as a second argument to each `RULES[task]` call: `rule(state, resetSignals)`.
- **Rationale**: Rule functions are already pure functions with no side effects. Passing signals as a parameter keeps them testable in isolation and adds zero coupling to storage or React lifecycle. JavaScript ignores extra positional arguments, so existing call sites without `resetSignals` continue to work unmodified (graceful fallback by convention).
- **Alternatives considered**:
  - Augment the `state` object with `__resetInfo` keys — rejected because it conflates persisted state with derived computation and pollutes the localStorage shape.
  - Compute `getResetInfo` directly inside each rule — rejected because it would require importing `SERVICES` into `rules.js`, creating a circular-dependency risk and duplicating calls.

---

## Decision 2 — Reset-aware tiebreaker logic

- **Decision**: At "comparable pressure" branch points in a rule, compare `daysRemaining` between two competing services. Prefer the service with the lower `daysRemaining` value (resets sooner) because spending quota that refreshes sooner has a lower long-horizon opportunity cost.
- **Rationale**: Matches the spec intent of FR-001 / US1 ("the option that better preserves long-horizon quota"). Spending the service that resets soon costs the user less because that quota will be replenished first. The competing service's quota can then be preserved for the longer tail.
- **Alternatives considered**:
  - Prefer the service with *higher* `daysRemaining` (save the soon-to-reset one) — rejected because it has the opposite effect: the user would burn quota they won't recover for a long time.
  - Use `due`/`overdue` as a hard override regardless of pressure — rejected as too aggressive; quota pressure is a stronger, verified signal; overdue may indicate the user simply hasn't logged the reset date yet.

---

## Decision 3 — Definition of "comparable pressure"

- **Decision**: Two services are comparable when their quota pressure difference is ≤ 15 percentage points, at a decision branch where the existing rule logic would otherwise route without differentiation (e.g., both services are in the "under-pressure" band).
- **Rationale**: A 15-point band is large enough to make reset timing meaningful for borderline cases without overriding clear-cut signals (e.g., a blocked vs. an available service).
- **Alternatives considered**:
  - Dynamic threshold (e.g., based on task priority) — rejected as untraceable and inconsistent with Constitution Principle II.
  - Any non-zero difference triggers the tiebreaker — rejected because it would make quota pressure signals irrelevant in the majority of decisions.

---

## Decision 4 — Fallback for unset / invalid / none reset states

- **Decision**: When `resetSignals` is absent for a service, or the service's reset state is `none`, `unset`, or `invalid`, the corresponding rule falls back to quota-only logic unchanged. No error is raised.
- **Rationale**: FR-004 and US3 both mandate graceful fallback. The existing rules already make valid decisions without reset data; the reset signal is strictly additive.
- **Alternatives considered**:
  - Return a warning or degraded recommendation — rejected because it adds friction for the majority of users who have not yet configured reset dates.

---

## Decision 5 — Due / overdue signal treatment

- **Decision**: When the selected service has a `due` or `overdue` reset state, the recommendation `reason` string appends a plain-language note: e.g., `"Reset due today — your quota may have already refreshed."` or `"Reset overdue by Xd — consider logging the new reset date."`. The selected service is NOT changed solely because of the overdue/due state.
- **Rationale**: FR-005 mandates that `due` and `overdue` are distinct signals; FR-003 mandates the reason reflects reset timing. However, overdue does not guarantee quota has refreshed (the user may not have logged it), so it would be misleading to treat it as a hard availability signal.
- **Alternatives considered**:
  - Treat `overdue` as equivalent to "available" (force-reset quota) — rejected because the stored quota value is the only authoritative signal; the reset tracker is advisory.

---

## Decision 6 — Affected rules

- **Decision**: Only three rules are augmented: `coding_hard`, `coding_light`, and `work_heavy`. `daily_chat` and `oneshot` are left unchanged.
- **Rationale**:
  - `daily_chat` compares Claude vs. ChatGPT at a coarse threshold and routes to ChatGPT as a general-purpose fallback — reset timing does not change this routing logic meaningfully.
  - `oneshot` routes purely on currency balance (`credits`) for pay-as-you-go services that have `resetType: 'payg'` and no scheduled reset cycle — reset signals are always `none` for these, so augmentation has no effect.
  - `coding_hard`, `coding_light`, and `work_heavy` all contain explicit pressure-comparison branches between Claude, Copilot, and ChatGPT (which do have scheduled resets), making them the meaningful sites for reset signal injection.

---

## Decision 7 — Test strategy

- **Decision**: New test file `src/utils.reco-reset.test.js` using the Node.js built-in `node:test` runner (consistent with `src/utils.reset.test.js`). Tests use fixture-based scenarios: for each affected rule, define a set of (quota inputs, reset signal inputs, expected output) triples.
- **Rationale**: Node.js `node:test` is already in use for frontend unit tests. No new test infrastructure or dependencies are needed.
- **Scenarios to cover**:
  - Rule selects service A over B solely due to reset proximity (both in comparable-pressure band)
  - Rule appends due-today note in reason when selected service is `due`
  - Rule appends overdue note in reason when selected service is `overdue`
  - Rule falls back to quota-only logic when `resetSignals` is undefined
  - Rule falls back to quota-only logic when both services have `state: 'unset'` or `'invalid'`
  - Rule falls back to quota-only logic when services have `state: 'none'` (payg services)

---

## Open Questions

None. All NEEDS CLARIFICATION items are resolved.
