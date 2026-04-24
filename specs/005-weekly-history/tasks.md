# Tasks: weekly-history

**Input**: Design documents from `/Users/raphael/Programmation/kairos/specs/005-weekly-history/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/weekly-history.md, quickstart.md

**Tests**: Include automated tests for behavior-changing utility, state, UI, and optional shared persistence changes. UI-only behavior may be completed with a documented manual quickstart verification when automation would be disproportionate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared weekly-history files and verify the existing state/export surfaces before story work begins.

- [X] T001 [P] Create empty weekly-history component stylesheet in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.module.css`
- [X] T002 [P] Create empty weekly-history component module in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.jsx`
- [X] T003 [P] Create weekly-history utility test file in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T004 [P] Review current local export/import mapping and note required weekly-history changes in `/Users/raphael/Programmation/kairos/src/services/localExport.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utility contracts and persistence keys required before any user story can record or review weekly history.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Add failing tests for local Monday-start week keys across month and year boundaries in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T006 [P] Add failing tests for deep-copy snapshot creation and quota normalization in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T007 Implement `getLocalWeekKey` in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T008 Implement `createWeeklySnapshot` with copied service metadata and reset-date values in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T009 Implement shared constants for weekly-history localStorage key, snapshot schema version, and snapshot logical-key prefix in `/Users/raphael/Programmation/kairos/src/utils.js`

**Checkpoint**: Utility foundation ready; user story implementation can now begin.

---

## Phase 3: User Story 1 - Preserve Weekly Quota State (Priority: P1) MVP

**Goal**: Preserve one canonical weekly quota snapshot per workspace and local calendar week, updating the current week in place when quota state changes.

**Independent Test**: Advance through multiple weeks with different quota states and confirm each week has a distinct saved snapshot, while same-week changes update the existing snapshot.

### Tests for User Story 1

- [X] T010 [P] [US1] Add failing tests for `upsertCurrentWeekSnapshot` duplicate prevention and immutable replacement in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T011 [P] [US1] Add failing tests for 52 completed week retention plus current week retention in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T012 [P] [US1] Add failing state-persistence tests for snapshot creation on load, same-week update, and reset recording in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T013 [P] [US1] Add failing shared snapshot contract coverage for `record_type='snapshot'` and `logical_key='weekly-history:{weekKey}'` in `/Users/raphael/Programmation/kairos/backend/tests/contract/shared-state-api.contract.test.js`

### Implementation for User Story 1

- [X] T014 [US1] Implement `upsertCurrentWeekSnapshot` and `retainWeeklySnapshots` in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T015 [US1] Add local weekly-history load/save helpers and current-week recording to `/Users/raphael/Programmation/kairos/src/hooks/useQuotaState.js`
- [X] T016 [US1] Update `updateQuota` and `resetAll` to record the resulting current-week snapshot without mutating live state in `/Users/raphael/Programmation/kairos/src/hooks/useQuotaState.js`
- [X] T017 [US1] Add shared weekly snapshot indexing, pull filtering, and current-week upsert scheduling in `/Users/raphael/Programmation/kairos/src/hooks/useSharedQuotaState.js`
- [X] T018 [US1] Implement snapshot create/update calls through existing shared records in `/Users/raphael/Programmation/kairos/src/hooks/useSharedQuotaState.js`
- [X] T019 [US1] Include weekly history in local export/import behavior without changing current quota values in `/Users/raphael/Programmation/kairos/src/services/localExport.js`

**Checkpoint**: User Story 1 should be fully functional and independently testable.

---

## Phase 4: User Story 2 - Review Consumption Patterns (Priority: P2)

**Goal**: Let users review saved weekly quota history by service and compare service quota values across weeks.

**Independent Test**: Create several weekly snapshots with varying service usage and verify the user can compare week-by-week values for each service.

### Tests for User Story 2

- [X] T020 [P] [US2] Add failing tests for ordered `deriveServiceHistorySeries` output and service-specific quota rows in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T021 [P] [US2] Add failing UI smoke tests or documented DOM fixture checks for multi-week service history rendering in `/Users/raphael/Programmation/kairos/src/weekly-history.integration.test.js`

### Implementation for User Story 2

- [X] T022 [US2] Implement `deriveServiceHistorySeries` for recorded entries and service display names in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T023 [US2] Expose `weeklyHistory`, `refreshWeeklyHistory`, and `getServiceHistory` from local state in `/Users/raphael/Programmation/kairos/src/hooks/useQuotaState.js`
- [X] T024 [US2] Expose workspace-scoped `weeklyHistory`, `refreshWeeklyHistory`, and `getServiceHistory` from shared state in `/Users/raphael/Programmation/kairos/src/hooks/useSharedQuotaState.js`
- [X] T025 [US2] Build service selector and weekly comparison table in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.jsx`
- [X] T026 [US2] Style the weekly history review surface, service selector, table, and comparison states in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.module.css`
- [X] T027 [US2] Render the weekly history panel with quota state hook data in `/Users/raphael/Programmation/kairos/src/App.jsx`
- [X] T028 [US2] Add layout support for the weekly history panel in `/Users/raphael/Programmation/kairos/src/App.module.css`

**Checkpoint**: User Stories 1 and 2 should both work independently.

---

## Phase 5: User Story 3 - Handle Incomplete History (Priority: P3)

**Goal**: Make missing weeks, missing service data, removed services, and short history visibly distinct from actual zero consumption.

**Independent Test**: Review history when one snapshot exists, when a service appears after prior snapshots, and when a reviewed range includes a week with no snapshot.

### Tests for User Story 3

- [X] T029 [P] [US3] Add failing tests for `missing_week`, `missing_service`, removed-service metadata, and insufficient-history flags in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T030 [P] [US3] Add failing UI smoke tests or documented DOM fixture checks for gap and insufficient-history messaging in `/Users/raphael/Programmation/kairos/src/weekly-history.integration.test.js`

### Implementation for User Story 3

- [X] T031 [US3] Extend `deriveServiceHistorySeries` with explicit `missing_week` and `missing_service` entries in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T032 [US3] Preserve and use captured service and quota metadata for removed or renamed services in `/Users/raphael/Programmation/kairos/src/utils.js`
- [X] T033 [US3] Render no-history, one-week, missing-week, missing-service, and removed-service messages in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.jsx`
- [X] T034 [US3] Style gap rows and insufficient-history states so they are visually distinct from zero consumption in `/Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.module.css`

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, accessibility, and consistency checks across weekly-history behavior.

- [X] T035 [P] Add quickstart manual verification notes for all acceptance scenarios in `/Users/raphael/Programmation/kairos/specs/005-weekly-history/quickstart.md`
- [X] T036 [P] Confirm backend shared snapshot records remain workspace-scoped and are not applied to live quota state in `/Users/raphael/Programmation/kairos/backend/tests/integration/us1-shared-sync.test.js`
- [X] T037 Run frontend weekly-history tests and fix failures in `/Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js`
- [X] T038 Run backend shared-state tests if shared snapshot persistence changed and fix failures in `/Users/raphael/Programmation/kairos/backend/tests/contract/shared-state-api.contract.test.js`
- [X] T039 Run full lint and test validation from `/Users/raphael/Programmation/kairos/package.json`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; delivers the MVP recording behavior.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from US1 snapshots, but can use fixtures for independent UI development.
- **User Story 3 (Phase 5)**: Depends on Foundational and extends US2 review output with gap semantics.
- **Polish (Phase 6)**: Depends on the selected user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories after Foundational.
- **User Story 2 (P2)**: Can start after Foundational using fixture history; production integration depends on US1 hook outputs.
- **User Story 3 (P3)**: Can start after Foundational using fixture history; complete UI messaging depends on US2 panel rendering.

### Within Each User Story

- Write tests first and confirm they fail before implementation.
- Implement pure utilities before hooks.
- Implement hooks before UI integration.
- Complete each checkpoint before using the story as a dependency for later work.

### Parallel Opportunities

- T001, T002, T003, and T004 can run in parallel.
- T005 and T006 can run in parallel before T007 through T009.
- T010 through T013 can run in parallel once Foundational is complete.
- T020 and T021 can run in parallel with T022 through T026 when fixture history is available.
- T029 and T030 can run in parallel with T031 and T032 when gap fixtures are defined.
- T035 and T036 can run in parallel during polish.

---

## Parallel Example: User Story 1

```text
Task: "T010 [P] [US1] Add failing tests for upsertCurrentWeekSnapshot duplicate prevention and immutable replacement in /Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js"
Task: "T011 [P] [US1] Add failing tests for 52 completed week retention plus current week retention in /Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js"
Task: "T012 [P] [US1] Add failing state-persistence tests for snapshot creation on load, same-week update, and reset recording in /Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js"
Task: "T013 [P] [US1] Add failing shared snapshot contract coverage for record_type='snapshot' and logical_key='weekly-history:{weekKey}' in /Users/raphael/Programmation/kairos/backend/tests/contract/shared-state-api.contract.test.js"
```

## Parallel Example: User Story 2

```text
Task: "T020 [P] [US2] Add failing tests for ordered deriveServiceHistorySeries output and service-specific quota rows in /Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js"
Task: "T021 [P] [US2] Add failing UI smoke tests or documented DOM fixture checks for multi-week service history rendering in /Users/raphael/Programmation/kairos/src/weekly-history.integration.test.js"
Task: "T025 [US2] Build service selector and weekly comparison table in /Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.jsx"
Task: "T026 [US2] Style the weekly history review surface, service selector, table, and comparison states in /Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.module.css"
```

## Parallel Example: User Story 3

```text
Task: "T029 [P] [US3] Add failing tests for missing_week, missing_service, removed-service metadata, and insufficient-history flags in /Users/raphael/Programmation/kairos/src/utils.weekly-history.test.js"
Task: "T030 [P] [US3] Add failing UI smoke tests or documented DOM fixture checks for gap and insufficient-history messaging in /Users/raphael/Programmation/kairos/src/weekly-history.integration.test.js"
Task: "T031 [US3] Extend deriveServiceHistorySeries with explicit missing_week and missing_service entries in /Users/raphael/Programmation/kairos/src/utils.js"
Task: "T034 [US3] Style gap rows and insufficient-history states so they are visually distinct from zero consumption in /Users/raphael/Programmation/kairos/src/components/WeeklyHistoryPanel.module.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundational utilities.
3. Complete Phase 3 User Story 1.
4. Stop and validate current-week creation, same-week update, week rollover, retention, and no live-state mutation.

### Incremental Delivery

1. Setup plus Foundational creates reusable weekly-history contracts.
2. US1 records canonical weekly snapshots.
3. US2 exposes service-by-service comparison.
4. US3 makes gaps and incomplete data explicit.
5. Polish validates quickstart, backend scoping, and full regression checks.

### Suggested MVP Scope

Complete through **User Story 1**: weekly snapshots are created, updated in place, retained, and scoped to the active workspace. This produces usable historical data before the review UI is expanded.

## Notes

- Keep weekly-history snapshots separate from current quota state storage.
- Do not add runtime dependencies.
- Do not synthesize snapshots for inactive weeks.
- Do not apply shared `snapshot` records to live quota values.
