# Tasks: Docker Container Packaging

**Input**: Design documents from `/specs/001-docker-container/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Include verification tasks for behavior-changing changes. For this feature, container verification uses executable shell checks plus manual browser validation where automation is disproportionate.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label for story-phase tasks only (`[US1]`, `[US2]`, `[US3]`)
- Each task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create baseline containerization structure and verification harness.

- [ ] T001 Create container artifact directory and helper scripts in docker/ and scripts/docker/
- [ ] T002 Create base ignore rules for image builds in .dockerignore
- [ ] T003 [P] Add container documentation section scaffold in README.md
- [ ] T004 [P] Add executable permissions and shebang consistency for scripts in scripts/docker/*.sh

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement core container build/runtime contract required by all user stories.

**⚠️ CRITICAL**: No user story work starts until this phase is complete.

- [ ] T005 Implement multi-stage container build in Dockerfile
- [ ] T006 [P] Add runtime web-server configuration for static assets in docker/nginx.conf
- [ ] T007 Define canonical image metadata and OCI labels in Dockerfile
- [ ] T008 [P] Implement container build script with tag input support in scripts/docker/build-image.sh
- [ ] T009 [P] Implement container run script with explicit port mapping in scripts/docker/run-local.sh
- [ ] T010 Create foundational container verification script in scripts/docker/verify-container.sh
- [ ] T011 Wire container helper commands into package scripts in package.json

**Checkpoint**: Foundation complete; user stories can proceed.

---

## Phase 3: User Story 1 - Run Anywhere with One Package (Priority: P1) 🎯 MVP

**Goal**: Operators can build and run one container artifact on a clean host and access the app without extra installation.

**Independent Test**: Build image from clean checkout, run container with documented command, and confirm app is reachable at mapped host port.

- [ ] T012 [P] [US1] Add US1 local deployment verification script in tests/integration/docker/us1-local-deploy.sh
- [ ] T013 [US1] Implement startup readiness endpoint routing in docker/nginx.conf
- [ ] T014 [US1] Add actionable startup failure handling in scripts/docker/run-local.sh
- [ ] T015 [US1] Document one-command local deployment flow in README.md
- [ ] T016 [US1] Add manual verification steps for clean-host deployment in specs/001-docker-container/quickstart.md
- [ ] T017 [US1] Execute and record US1 verification outcomes in specs/001-docker-container/verification/us1-results.md

**Checkpoint**: US1 is independently deployable and testable as MVP.

---

## Phase 4: User Story 2 - Deploy on Self-Hosted Infrastructure (Priority: P2)

**Goal**: Self-hosted admins can run the same image with persistent service behavior and restart support.

**Independent Test**: Launch container in detached mode with restart policy on a self-hosted-like environment, restart container, and confirm service remains available.

- [ ] T018 [P] [US2] Add self-hosted run script with restart policy in scripts/docker/run-selfhosted.sh
- [ ] T019 [P] [US2] Add self-hosted health-check script in tests/integration/docker/us2-selfhosted-health.sh
- [ ] T020 [US2] Document self-hosted deployment and restart procedure in README.md
- [ ] T021 [US2] Define required and optional runtime configuration schema in specs/001-docker-container/contracts/container-runtime-contract.md
- [ ] T022 [US2] Add configuration validation and error output in scripts/docker/run-selfhosted.sh
- [ ] T023 [US2] Execute and record US2 restart/health validation in specs/001-docker-container/verification/us2-results.md

**Checkpoint**: US2 self-hosted deployment flow works independently.

---

## Phase 5: User Story 3 - Consistent Operations Across Environments (Priority: P3)

**Goal**: Teams can deploy the same immutable image tag across environments with consistent startup behavior.

**Independent Test**: Deploy one image tag to two environments (or two environment profiles), run same verification script, and compare outcomes.

- [ ] T024 [P] [US3] Add environment profile samples for dev/staging/prod in docker/env/
- [ ] T025 [P] [US3] Add cross-environment consistency verification script in tests/integration/docker/us3-consistency-check.sh
- [ ] T026 [US3] Implement immutable-tag enforcement checks in scripts/docker/build-image.sh
- [ ] T027 [US3] Document multi-environment deployment matrix in specs/001-docker-container/quickstart.md
- [ ] T028 [US3] Add rollback procedure with explicit prior tag usage in README.md
- [ ] T029 [US3] Execute and record cross-environment validation in specs/001-docker-container/verification/us3-results.md

**Checkpoint**: US3 confirms consistent behavior across environments.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, docs alignment, and full quickstart validation.

- [ ] T030 [P] Add verification artifact index and traceability table in specs/001-docker-container/verification/README.md
- [ ] T031 Align quickstart and runtime contract details in specs/001-docker-container/quickstart.md and specs/001-docker-container/contracts/container-runtime-contract.md
- [ ] T032 [P] Run full container quickstart and capture final evidence in specs/001-docker-container/verification/final-validation.md
- [ ] T033 Update changelog entry for Docker packaging delivery in CHANGELOG.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2 completion.
- **Phase 4 (US2)**: Depends on Phase 2 completion; can proceed after US1 MVP validation.
- **Phase 5 (US3)**: Depends on Phase 2 completion and benefits from US1/US2 outputs.
- **Phase 6 (Polish)**: Depends on completion of selected user stories.

### User Story Dependencies

- **US1 (P1)**: No dependency on other user stories.
- **US2 (P2)**: No hard dependency on US1, but reuses foundation and may reuse US1 scripts/docs.
- **US3 (P3)**: Depends on shared foundation and references artifacts from US1/US2 for consistency comparison.

### Within Each User Story

- Verification script task first.
- Runtime/config implementation tasks second.
- Documentation updates third.
- Evidence capture task last.

### Parallel Opportunities

- Setup: T003 and T004 can run in parallel after T001.
- Foundational: T006, T008, and T009 can run in parallel after T005.
- US1: T012 can run in parallel with T013.
- US2: T018 and T019 can run in parallel.
- US3: T024 and T025 can run in parallel.
- Polish: T030 and T032 can run in parallel.

---

## Parallel Example: User Story 2

```bash
Task: "T018 [US2] Add self-hosted run script in scripts/docker/run-selfhosted.sh"
Task: "T019 [US2] Add self-hosted health-check script in tests/integration/docker/us2-selfhosted-health.sh"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete US1 tasks (T012-T017).
3. Validate US1 independently before expanding scope.

### Incremental Delivery

1. Deliver MVP with US1.
2. Add self-hosted operations with US2.
3. Add cross-environment consistency and rollback confidence with US3.
4. Complete polish phase and final validation evidence.

### Parallel Team Strategy

1. One engineer finalizes foundational container build/runtime tasks.
2. After foundation is stable:
   - Engineer A executes US1.
   - Engineer B executes US2.
   - Engineer C executes US3 consistency tooling.

---

## Notes

- All tasks strictly follow `- [ ] T### [P?] [US?] Description with file path`.
- Story-labeled tasks appear only in user story phases.
- Each user story includes an independent verification target and evidence task.
