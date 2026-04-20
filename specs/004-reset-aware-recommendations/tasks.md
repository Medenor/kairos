# Tasks: reset-aware-recommendations

**Input**: Design documents from `/specs/004-reset-aware-recommendations/`
**Prerequisites**: plan.md ✓, spec.md ✓, data-model.md ✓, contracts/reco-reset.md ✓, quickstart.md ✓
**Branch**: `004-reset-aware-recommendations`

**Tests**: Tests are required — this feature changes deterministic recommendation behavior across all task types (FR-001 to FR-008). New test file: `src/utils.reco-reset.test.js` using Node.js built-in `node:test` runner.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files or independent blocks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in all descriptions

---

## Phase 1: Setup

**Purpose**: Confirm baseline — no new dependencies or directories required for this feature.

- [X] T001 Audit `src/utils.js` to confirm `getResetInfo` and `RESET_DATE_KEY` are exported and callable with the expected signature `(lastResetDate, resetCycleDays, now?)` — no changes needed, reading only

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure utility functions required by all three user stories before any rule can be augmented.

**⚠️ CRITICAL**: All user story phases depend on T002 and T003 being complete.

- [X] T002 Add `getResetSignals(state, services)` pure function export to `src/utils.js` — iterates `services`, calls `getResetInfo(state[svc.id]?.[RESET_DATE_KEY] ?? null, svc.resetCycleDays)` for each service, returns a plain object keyed by `svc.id`; no side effects
- [X] T003 [P] Add `resetTiebreaker(sigA, sigB, pressureA, pressureB)` and `resetNote(signal)` private helper functions at the top of `src/data/rules.js` — `resetTiebreaker` returns `true` when both `daysRemaining` are non-null AND `|pressureA - pressureB| <= 15`; `resetNote` returns the due/overdue suffix string or `''`

**Checkpoint**: `getResetSignals`, `resetTiebreaker`, and `resetNote` are available — user story implementation can begin.

---

## Phase 3: User Story 1 — Recommend With Reset Timing (Priority: P1) 🎯 MVP

**Goal**: When two services have comparable quota pressure (within 15 percentage points), the service with the soonest scheduled reset is preferred as the primary recommendation.

**Independent Test**: Set `coding_hard` state with `claude.weekly = 70`, `copilot.monthly = 60`, Claude reset in 1d, Copilot reset in 20d — confirm `coding_light` and `coding_hard` tiebreaker selects Claude. Then swap reset days — confirm it switches to Copilot.

### Tests for User Story 1 ⚠️

> **Write these tests FIRST and confirm they FAIL before implementing T007–T010**

- [X] T004 [P] [US1] Write test scenarios for `coding_hard` reset tiebreaker in `src/utils.reco-reset.test.js`: comparable pressure (within 15 pts) → prefer sooner reset; gap > 15 pts → no tiebreaker; both signals `countdown` but same days → no change
- [X] T005 [P] [US1] Write test scenarios for `coding_light` reset tiebreaker in `src/utils.reco-reset.test.js`: Claude and Copilot at comparable pressure → prefer sooner reset; quota-dominant path unchanged
- [X] T006 [P] [US1] Write test scenarios for `work_heavy` reset tiebreaker in `src/utils.reco-reset.test.js`: Claude and ChatGPT at comparable pressure → prefer sooner reset; Claude blocked → Copilot/ChatGPT tiebreaker

### Implementation for User Story 1

- [X] T007 [US1] Augment `coding_hard` rule in `src/data/rules.js` — add `(s, rs)` signature; add reset tiebreaker branch at the `c < 85` decision point comparing `claude` vs `copilot` and at the Claude-blocked branch comparing `copilot` vs `chatgpt`; reason strings updated to include reset context (e.g., `"Claude under pressure — resets in 1d vs Copilot's 20d. Spend Claude now."`)
- [X] T008 [US1] Augment `coding_light` rule in `src/data/rules.js` — add `(s, rs)` signature; add reset tiebreaker at the `cop < 50` / `c < 50` decision branches comparing `copilot` vs `claude`; reason strings updated to include reset context when tiebreaker applies
- [X] T009 [US1] Augment `work_heavy` rule in `src/data/rules.js` — add `(s, rs)` signature; add reset tiebreaker at the `c < 80` pressure branch comparing `claude` vs `chatgpt`; reason strings updated to include reset context when tiebreaker applies
- [X] T010 [US1] Update `src/components/RecoBox.jsx` — import `SERVICES` from `../data/services` and `getResetSignals` from `../utils`; compute `const resetSignals = getResetSignals(state, SERVICES)` before the rule call; pass `resetSignals` as second argument to `rule(state, resetSignals)`

**Checkpoint**: User Story 1 is independently testable — run `node --test src/utils.reco-reset.test.js` for T004–T006 scenarios, and manually verify recommendation switches when reset timing differs.

---

## Phase 4: User Story 2 — Explain Reset Influence (Priority: P2)

**Goal**: The recommendation `reason` string explicitly states when and why reset timing influenced the outcome. Users can identify the reset-based rationale in under 20 seconds.

**Independent Test**: Trigger each augmented rule with a reset-tiebreaker scenario and assert the returned `reason` string includes both service names, days-remaining values, and the rationale phrase. Trigger a `due`/`overdue` scenario and assert the appended note appears verbatim.

### Tests for User Story 2 ⚠️

> **Write these tests FIRST and confirm they FAIL before implementing T013–T014**

- [X] T011 [P] [US2] Write test scenarios in `src/utils.reco-reset.test.js` asserting reason strings mention reset timing (service name + days) when tiebreaker is decisive across all three augmented rules
- [X] T012 [P] [US2] Write test scenarios in `src/utils.reco-reset.test.js` asserting reason appends `"Reset due today — your quota may have already refreshed."` when selected service state is `due`, and `"Reset overdue — consider logging the new reset date."` when state is `overdue`

### Implementation for User Story 2

- [X] T013 [US2] Verify all tiebreaker return paths in `src/data/rules.js` (`coding_hard`, `coding_light`, `work_heavy`) name both compared services and include days-remaining values in the reason string (e.g., `"Copilot resets in 3d vs Claude's 18d"`) — adjust any reason string that omits this detail
- [X] T014 [US2] Verify `resetNote(rs?.primary)` is appended to every reason string in all three augmented rules for `due` and `overdue` states in `src/data/rules.js` — including the non-tiebreaker branches (Claude available, Claude blocked, etc.)

**Checkpoint**: User Story 2 independently testable — scenario-driven assertions confirm reason strings meet SC-002 (100% of tiebreaker scenarios mention reset timing).

---

## Phase 5: User Story 3 — Safe Fallback Behavior (Priority: P3)

**Goal**: Recommendations remain valid and error-free when reset dates are missing, invalid, or absent. Quota-only logic is the deterministic fallback in all such cases.

**Independent Test**: Clear all reset dates (or pass `resetSignals = undefined`) and confirm all five rules return valid `{ primary, reason, alts }` objects with quota-only reason text and no reset mention.

### Tests for User Story 3 ⚠️

> **Write these tests FIRST and confirm they FAIL before implementing T018–T019**

- [X] T015 [P] [US3] Write test scenarios in `src/utils.reco-reset.test.js` asserting quota-only result is returned when `resetSignals` is `undefined` for `coding_hard`, `coding_light`, and `work_heavy`
- [X] T016 [P] [US3] Write test scenarios in `src/utils.reco-reset.test.js` asserting quota-only result is returned when both compared services have state `unset`, `invalid`, or `none` — reason MUST NOT mention reset timing
- [X] T017 [P] [US3] Write test scenarios in `src/utils.reco-reset.test.js` for edge cases: one service `countdown` and one `unset` (tiebreaker skipped, quota-only); both services same `daysRemaining` (no preference change); service state `overdue` (note added but not used as tiebreaker)

### Implementation for User Story 3

- [X] T018 [US3] Add `if (!resetSignals)` guard at the top of each augmented rule function in `src/data/rules.js` — returns the existing quota-only result unchanged; confirm `daily_chat` and `oneshot` rules are NOT modified (they never use resetSignals)
- [X] T019 [US3] Verify `getResetSignals` in `src/utils.js` handles `state[svc.id]` being `undefined` or missing `RESET_DATE_KEY` without throwing — confirm optional chaining `state[svc.id]?.[RESET_DATE_KEY] ?? null` is in place and returns a valid `ResetTimingSignal` for every service

**Checkpoint**: All three user stories independently functional and testable — run full test suite to confirm no regressions.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify determinism, backward compatibility, and all acceptance criteria across the full feature.

- [X] T020 [P] Run all existing tests to confirm no regressions: `node --test src/utils.reset.test.js` — verify 0 failures before and after the feature
- [X] T021 [P] Run new test file to confirm all US1–US3 scenarios pass: `node --test src/utils.reco-reset.test.js`
- [X] T022 Execute the manual verification checklist from `specs/004-reset-aware-recommendations/quickstart.md` — cover all five checklist items (tiebreaker switch, overdue note, cleared dates, invalid dates, `coding_light` example)
- [X] T023 Verify `daily_chat` and `oneshot` rules in `src/data/rules.js` are untouched and return identical results with or without `resetSignals` passed (no accidental modifications)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (T002, T003 complete)
- **US2 (Phase 4)**: Depends on Phase 3 — reason string enrichment requires tiebreaker branches to exist
- **US3 (Phase 5)**: Depends on Phase 3 — fallback guards are part of the same augmented rule functions
- **Polish (Phase 6)**: Depends on Phases 3, 4, 5 all complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependency on US2 or US3
- **US2 (P2)**: Depends on US1 implementation (reason strings are in the tiebreaker branches)
- **US3 (P3)**: Can start after Phase 2 in parallel with US1 (guard tests are independent of tiebreaker tests)

### Within Each User Story

1. Write tests → confirm they FAIL
2. Implement (foundational helpers → rule augmentation → RecoBox wiring)
3. Confirm tests PASS
4. Move to next story

### Parallel Opportunities

- **Phase 2**: T002 (`src/utils.js`) and T003 (`src/data/rules.js`) touch different files — can run in parallel
- **Phase 3 tests**: T004, T005, T006 all add scenarios to the same new file — write sequentially or coordinate
- **Phase 4 tests**: T011, T012 write to `src/utils.reco-reset.test.js` — sequential preferred
- **Phase 5 tests**: T015, T016, T017 write to `src/utils.reco-reset.test.js` — sequential preferred
- **Phase 6**: T020 and T021 run different test files — can run in parallel

---

## Implementation Strategy

### MVP Scope (Phase 1 → Phase 3)

Delivering US1 alone (reset-aware tiebreaker active, reason strings include reset context) is a releasable increment. US2 and US3 can ship in the same PR since they are small additions to the same functions.

### Incremental Delivery Order

1. **T001–T003** (Setup + Foundational): ~30 min — pure utility functions, no UI changes
2. **T004–T006** (US1 tests): ~45 min — scenario fixtures using `node:test`
3. **T007–T010** (US1 implementation): ~60 min — surgical augmentation of 3 rules + RecoBox wiring
4. **T011–T014** (US2 tests + verification): ~30 min — reason string assertions
5. **T015–T019** (US3 tests + fallback guards): ~30 min — guard checks and edge-case tests
6. **T020–T023** (Polish): ~20 min — full suite run + manual checklist

### Risk Notes

- `RecoBox.jsx` import of `SERVICES` — confirm `SERVICES` is already exported from `src/data/services.js` before T010
- Rules `daily_chat` and `oneshot` must remain unmodified — T023 verifies this explicitly
- `getResetSignals` must use the same `now` default as `getResetInfo` to preserve determinism in tests — pass an explicit `now` fixture in test scenarios
