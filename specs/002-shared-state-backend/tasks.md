# Tasks: Shared State Backend

**Input**: Design documents from `/specs/002-shared-state-backend/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Include verification tasks for every behavior-changing change. Use automated tests by default; for UI-only changes, a documented manual verification task is acceptable when automation is disproportionate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Web app: `backend/src/`, `src/`, `backend/tests/`, `tests/`
- API contract: `specs/002-shared-state-backend/contracts/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize backend workspace and baseline tooling for shared-state development

- [X] T001 Create backend service scaffold and module layout in `backend/src/api/`, `backend/src/auth/`, `backend/src/db/`, `backend/src/migrations/`, `backend/src/services/`, `backend/src/sync/`
- [X] T002 Initialize backend package and scripts in `backend/package.json` and `package.json` (workspace-level script wiring)
- [X] T003 [P] Add backend environment template and defaults in `backend/.env.example` and `backend/src/config/env.js`
- [X] T004 [P] Add backend test/lint runner configuration in `backend/vitest.config.js` and `backend/eslint.config.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core primitives required before any user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Implement SQLite connection and transaction helpers in `backend/src/db/client.js`
- [X] T006 Create initial SQL schema and migration runner for foundational entities in `backend/src/migrations/001_initial_schema.sql` and `backend/src/db/migrate.js`
- [X] T007 [P] Implement shared API server bootstrap and middleware pipeline in `backend/src/server.js` and `backend/src/api/router.js`
- [X] T008 [P] Implement auth primitives (password hashing, token issue/verify, session storage) in `backend/src/auth/password.js`, `backend/src/auth/session.js`, and `backend/src/auth/middleware.js`
- [X] T009 [P] Implement request validation and normalized API error envelope in `backend/src/api/validation.js` and `backend/src/api/errors.js`
- [X] T010 Implement audit/security event logger used by all routes in `backend/src/services/security-event-service.js`
- [X] T011 Add test database bootstrap and fixture helpers in `backend/tests/helpers/test-db.js` and `backend/tests/helpers/fixtures.js`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Shared Data Across Devices (Priority: P1) 🎯 MVP

**Goal**: Users on different LAN devices can read/write the same shared state through an authenticated API

**Independent Test**: Create/update a record from Device A and verify Device B retrieves the same updated record via sync/list endpoints

### Tests for User Story 1

- [X] T012 [P] [US1] Add contract tests for `/auth/login`, `/workspaces/{workspaceId}/records`, and `/workspaces/{workspaceId}/sync/pull` in `backend/tests/contract/shared-state-api.contract.test.js`
- [X] T013 [P] [US1] Add integration test for cross-device record propagation in `backend/tests/integration/us1-shared-sync.test.js`
- [X] T014 [P] [US1] Add integration test for version-conflict response (409) in `backend/tests/integration/us1-conflict-handling.test.js`

### Implementation for User Story 1

- [X] T015 [P] [US1] Implement repository modules for `Workspace`, `WorkspaceMember`, and `SharedRecord` in `backend/src/db/repositories/workspace-repo.js`, `backend/src/db/repositories/workspace-member-repo.js`, and `backend/src/db/repositories/shared-record-repo.js`
- [X] T016 [P] [US1] Implement `RecordRevision` write path in `backend/src/db/repositories/record-revision-repo.js`
- [X] T017 [US1] Implement shared record service with optimistic concurrency rules in `backend/src/services/shared-record-service.js`
- [X] T018 [US1] Implement auth routes `/auth/login` and `/auth/logout` in `backend/src/api/routes/auth-routes.js`
- [X] T019 [US1] Implement record CRUD routes and sync pull route in `backend/src/api/routes/record-routes.js` and `backend/src/api/routes/sync-routes.js`
- [X] T020 [US1] Wire route registration and authorization guards in `backend/src/api/router.js`
- [X] T021 [US1] Implement frontend API client for auth and record/sync operations in `src/services/sharedStateApi.js`
- [X] T022 [US1] Implement frontend shared-state hook replacing local-only reads/writes with backend sync in `src/hooks/useSharedQuotaState.js`
- [X] T023 [US1] Integrate shared-state hook into app flow and service cards in `src/App.jsx` and `src/components/ServiceCard.jsx`
- [X] T024 [US1] Add user-visible sync/conflict state UI in `src/components/SummaryBar.jsx` and `src/components/SummaryBar.module.css`

**Checkpoint**: User Story 1 is independently functional and testable

---

## Phase 4: User Story 2 - Safe Migration from Browser-Only Data (Priority: P2)

**Goal**: Existing localStorage state can be imported once, retried safely, and reported with per-record outcomes

**Independent Test**: Seed localStorage on one device, run migration, verify imported records and no duplicates on rerun with same idempotency key

### Tests for User Story 2

- [X] T025 [P] [US2] Add contract tests for `/workspaces/{workspaceId}/migrations/local-storage` and `/workspaces/{workspaceId}/migrations/{jobId}` in `backend/tests/contract/migration-api.contract.test.js`
- [X] T026 [P] [US2] Add integration test for successful migration and status accounting in `backend/tests/integration/us2-migration-success.test.js`
- [X] T027 [P] [US2] Add integration test for idempotent rerun and malformed-record handling in `backend/tests/integration/us2-migration-idempotency.test.js`

### Implementation for User Story 2

- [X] T028 [P] [US2] Implement `MigrationJob` repository and persistence helpers in `backend/src/db/repositories/migration-job-repo.js`
- [X] T029 [US2] Implement localStorage mapping and validation logic in `backend/src/services/localstorage-import-mapper.js`
- [X] T030 [US2] Implement migration orchestration service (idempotency, counters, error report) in `backend/src/services/migration-service.js`
- [X] T031 [US2] Implement migration API routes in `backend/src/api/routes/migration-routes.js`
- [X] T032 [US2] Register migration routes and idempotency middleware in `backend/src/api/router.js` and `backend/src/api/idempotency.js`
- [X] T033 [US2] Add frontend local export and migration trigger utility in `src/services/localExport.js` and `src/services/sharedStateApi.js`
- [X] T034 [US2] Add migration UI/status panel and retry flow in `src/components/MigrationPanel.jsx`, `src/components/MigrationPanel.module.css`, and `src/App.jsx`

**Checkpoint**: User Stories 1 and 2 both work independently

---

## Phase 5: User Story 3 - Controlled Local-Network Access and Recovery (Priority: P3)

**Goal**: Enforce authenticated LAN-only access and provide backup/restore workflows with auditability

**Independent Test**: Unauthorized access is denied; backup snapshot can be created and restored after simulated destructive change

### Tests for User Story 3

- [X] T035 [P] [US3] Add contract tests for backup endpoints and restore trigger in `backend/tests/contract/backup-api.contract.test.js`
- [X] T036 [P] [US3] Add integration test for access denial without valid session in `backend/tests/integration/us3-authz-deny.test.js`
- [X] T037 [P] [US3] Add integration test for backup-create and restore workflow in `backend/tests/integration/us3-backup-restore.test.js`

### Implementation for User Story 3

- [X] T038 [P] [US3] Implement `BackupSnapshot` repository in `backend/src/db/repositories/backup-snapshot-repo.js`
- [X] T039 [US3] Implement LAN restriction middleware and allowed-subnet checks in `backend/src/api/lan-restriction.js` and `backend/src/config/env.js`
- [X] T040 [US3] Implement backup create/list/restore services in `backend/src/services/backup-service.js`
- [X] T041 [US3] Implement backup API routes in `backend/src/api/routes/backup-routes.js`
- [X] T042 [US3] Register backup routes and security-event logging hooks in `backend/src/api/router.js` and `backend/src/services/security-event-service.js`
- [X] T043 [US3] Add frontend backup/restore operator panel in `src/components/BackupPanel.jsx`, `src/components/BackupPanel.module.css`, and `src/App.jsx`

**Checkpoint**: All user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, docs, and full-scenario verification across stories

- [X] T044 [P] Add regression tests for end-to-end quickstart scenarios in `backend/tests/integration/quickstart-e2e.test.js`
- [X] T045 [P] Add container/runtime wiring for frontend+backend LAN deployment in `docker/docker-compose.shared.yml` and `scripts/docker/run-shared.sh`
- [X] T046 Update operational docs for shared-state setup, migration, and privacy defaults in `README.md` and `specs/002-shared-state-backend/quickstart.md`
- [X] T047 Run full verification (`npm run lint`, backend tests, integration tests) and capture results in `specs/002-shared-state-backend/verification.md`
- [X] T048 [P] Update CHANGELOG UNRELEASED section with summary of shared state backend implementation and any important notes for users in `CHANGELOG.md`
- [X] T049 [P] Update README with shared state backend overview, setup instructions, and links to docs in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - starts immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - blocks all user stories
- **Phase 3 (US1)**: Depends on Phase 2 - MVP delivery
- **Phase 4 (US2)**: Depends on Phase 2 and integrates with US1 shared models/services
- **Phase 5 (US3)**: Depends on Phase 2 and uses established auth/data services
- **Phase 6 (Polish)**: Depends on completion of selected user stories

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2; no dependency on other user stories
- **US2 (P2)**: Can start after Phase 2; requires shared-record/auth infrastructure from foundational work and integrates with US1 API client
- **US3 (P3)**: Can start after Phase 2; uses auth/session and shared DB primitives from foundational work

### Within Each User Story

- Contract/integration tests first and failing
- Repositories/models before services
- Services before route handlers
- Backend endpoints before frontend integration
- Story-level verification before proceeding

### Parallel Opportunities

- Phase 1: T003 and T004 can run in parallel with T001/T002 once directories exist
- Phase 2: T007, T008, and T009 can run in parallel after DB baseline tasks start
- US1: T012, T013, T014 parallel; T015 and T016 parallel
- US2: T025, T026, T027 parallel; T028 can run parallel with mapper scaffolding
- US3: T035, T036, T037 parallel; T038 parallel with T039
- Phase 6: T044 and T045 parallel

---

## Parallel Example: User Story 1

```bash
# Parallel test work for US1
Task: "T012 [US1] Contract tests in backend/tests/contract/shared-state-api.contract.test.js"
Task: "T013 [US1] Cross-device integration test in backend/tests/integration/us1-shared-sync.test.js"
Task: "T014 [US1] Conflict handling integration test in backend/tests/integration/us1-conflict-handling.test.js"

# Parallel backend model/repository work for US1
Task: "T015 [US1] Repositories in backend/src/db/repositories/*.js"
Task: "T016 [US1] Revision repository in backend/src/db/repositories/record-revision-repo.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational)
3. Complete Phase 3 (US1)
4. Validate US1 independently on two devices in the same LAN
5. Demo/deploy MVP

### Incremental Delivery

1. Foundation complete (Phases 1-2)
2. Deliver US1 and validate
3. Add US2 migration and validate idempotency
4. Add US3 backup/security controls and validate restore/access-denial
5. Run Phase 6 polish and verification

### Parallel Team Strategy

1. Team aligns on Phases 1-2 together
2. After Phase 2:
   - Engineer A drives US1 API + frontend sync
   - Engineer B drives US2 migration pipeline
   - Engineer C drives US3 backup/security path
3. Merge on contract-first boundaries and run shared verification

---

## Notes

- [P] tasks indicate disjoint files and minimal coupling
- [USx] labels map directly to the stories in `spec.md`
- Each user story remains independently testable
- Prefer small commits per task or tightly related task cluster
