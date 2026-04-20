# Tasks: reset-date-tracking

**Input**: Design documents from `/specs/003-reset-date-tracking/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Include verification tasks for every behavior-changing change. Use automated tests by default; for UI-only changes, a documented manual verification task is acceptable when automation is disproportionate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Extend the existing service state shape and prepare the feature surface

- [X] T001 [P] Update the service definitions in `src/data/services.js` to include reset-cycle metadata needed for countdown calculations.
- [X] T002 [P] Extend shared state defaults and merge logic in `src/hooks/useQuotaState.js` and `src/hooks/useSharedQuotaState.js` to carry per-service last reset dates.
- [X] T003 [P] Update local export/import handling in `src/services/localExport.js` so reset-date data is preserved during export.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core state and formatting behavior required before any user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Add shared date utilities in `src/utils.js` for computing days remaining and handling unset/overdue states deterministically.
- [X] T005 [P] Add any backend shared-record/schema support needed in `backend/src/migrations/001_initial_schema.sql` and related services so reset-date state can persist with existing shared records.
- [X] T006 [P] Add contract or integration coverage for persistence of reset-date fields in `backend/tests/contract/` or `backend/tests/integration/` as appropriate to the existing state model.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Track Last Reset Date (Priority: P1) 🎯 MVP

**Goal**: Let a user enter, update, and clear the last reset date for each service.

**Independent Test**: Change a service’s reset date, refresh, and confirm the same value remains associated with that service.

### Tests for User Story 1 (REQUIRED for behavior changes) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T007 [P] [US1] Add unit coverage for set/update/clear behavior in `src/utils.js` or a dedicated helper test file.
- [ ] T008 [P] [US1] Add UI behavior verification for editing a service reset date in `src/components/ServiceCard.jsx` and `src/App.jsx`.

### Implementation for User Story 1

- [X] T009 [US1] Add last-reset-date input and controls to `src/components/ServiceCard.jsx`.
- [X] T010 [US1] Wire reset-date updates through `src/App.jsx` into `src/hooks/useQuotaState.js` and `src/hooks/useSharedQuotaState.js`.
- [X] T011 [US1] Ensure reset-date data is serialized and restored for each service in `src/services/localExport.js` and any shared-state persistence path.
- [X] T012 [US1] Add clear empty-state behavior for services with no saved reset date in `src/components/ServiceCard.jsx`.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Show Countdown (Priority: P2)

**Goal**: Display the remaining days until the next reset for each service with a saved reset date.

**Independent Test**: Save a reset date and confirm the displayed countdown matches the expected remaining days for that service.

### Tests for User Story 2 (REQUIRED for behavior changes) ⚠️

- [X] T013 [P] [US2] Add unit coverage for remaining-day calculations and overdue handling in `src/utils.js`.
- [ ] T014 [P] [US2] Add UI verification for countdown rendering in `src/components/ServiceCard.jsx`.

### Implementation for User Story 2

- [X] T015 [US2] Render the days-remaining countdown in `src/components/ServiceCard.jsx` using the shared date utilities.
- [X] T016 [US2] Show overdue or due-now messaging when the calculated next reset date has passed.
- [X] T017 [US2] Keep the countdown display in sync when service reset data changes in `src/hooks/useQuotaState.js` and `src/hooks/useSharedQuotaState.js`.

**Checkpoint**: At this point, User Stories 1 and 2 should both work independently

---

## Phase 5: User Story 3 - Handle Missing Data (Priority: P3)

**Goal**: Make unset reset dates obvious so users know which services still need setup.

**Independent Test**: Open a service without a saved reset date and confirm the UI shows an explicit unset state instead of a countdown.

### Tests for User Story 3 (REQUIRED for behavior changes) ⚠️

- [X] T018 [P] [US3] Add unit coverage for unset-date display logic in `src/utils.js` or component-level helpers.
- [ ] T019 [P] [US3] Add UI verification for the unset state in `src/components/ServiceCard.jsx`.

### Implementation for User Story 3

- [X] T020 [US3] Add unset-state messaging and visual treatment in `src/components/ServiceCard.jsx`.
- [X] T021 [US3] Ensure removing a reset date restores the unset state without affecting other service values in `src/hooks/useQuotaState.js` and `src/hooks/useSharedQuotaState.js`.

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T022 [P] Update `specs/003-reset-date-tracking/quickstart.md` with the final verification steps after implementation details are confirmed.
- [X] T023 [P] Add or adjust any documentation in `README.md` if the reset-date workflow is user-facing and needs explanation.
- [X] T024 Run `npm test` and `npm run lint` to verify the feature across frontend and backend checks.
- [ ] T025 Validate manual UI behavior in the browser for at least one service with a set date, one overdue service, and one unset service.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests for behavior changes MUST be written and FAIL before implementing the matching feature
- Shared date calculations before UI display
- State persistence before dependent rendering
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001, T002, and T003 can run in parallel because they touch different persistence and export concerns
- T005 and T006 can run in parallel once the shared date model is defined
- Tests for each user story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members after the foundation is complete

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
