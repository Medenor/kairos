# Implementation Plan: surplus-runner

**Branch**: `006-surplus-runner` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-surplus-runner/spec.md`

## Summary

Add an idea queue and a deterministic "which idea for this expiring quota" evaluation to the dashboard (User Stories 1, 2, 4), then an optional **runner**: a separate zero-dependency Node CLI that the user starts on their own machine. The runner polls the shared-state API, re-runs the same pure evaluation, and starts at most one approved idea at a time through the service's official terminal tool (`claude -p`, `codex exec`) inside a disposable copy of the working folder (User Story 3).

Technical approach, in one paragraph: all rules live in pure ES modules under `src/surplus/` that take `now` and plain data, so the browser and the runner import the same code and tests run in plain Node. Ideas, policy, run records and reset-cycle records sync as shared records under `routing_config` with namespaced logical keys, so no SQL migration is needed. Authorisation never comes from the shared store: the runner keeps its own approvals, content hashes and configuration in a local directory, and approval is a terminal prompt on the runner device. New quota-reading timestamps use the existing per-service `__key` pattern, so they follow the quota state's persistence and sync rules unchanged. The existing reset day count is moved to the user's local calendar day so the dashboard and the evaluation agree near midnight.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node.js 26 LTS (frontend, backend and runner)

**Primary Dependencies**: React 18, React DOM 18, Vite 5; runner uses Node built-ins only (`node:child_process`, `node:fs`, `node:crypto`, `node:readline`). No new runtime dependency.

**Storage**: `localStorage` for local-first ideas, policy, runs and cycle records (keys `kairos:surplus:*`); shared mode syncs them as `routing_config` records with logical keys `surplus-policy`, `surplus-control`, `idea:{id}`, `run:{id}`, `cycle:{serviceId}:{resetDate}`, `runner-lease`. Runner-local files under `~/.kairos-runner/` (config, approvals, journal, disposable copies, full run output).

**Testing**: Node `node:test`. Pure-rule tests in `src/surplus/*.test.js`; runner tests in `runner/**/*.test.js` with a fake CLI binary and a fake API server; backend contract test for the new record namespaces. `npm test` is extended to include `runner/`.

**Target Platform**: Static browser frontend (unchanged, works offline); optional LAN backend (unchanged schema); runner on the user's macOS/Linux machine where `claude` / `codex` are signed in.

**Project Type**: Web application (frontend + optional backend) plus a new local CLI process (`runner/`).

**Performance Goals**: Evaluation of all services over 200 ideas under 16 ms in the browser (pure, synchronous); queue capture in under 10 s and three interactions (SC-001).

**Constraints**: Offline-capable queue, evaluation and suggestions (FR-023); deterministic given `(state, policy, ideas, runs, now, folderChecks)`; runner honours a global stop before the next run starts and within 5 s of a user trigger (SC-007); at most one active run per workspace; no credential read, copy or transmission (FR-015).

**Scale/Scope**: 2 supported services (Claude, ChatGPT Codex), up to a few hundred ideas per workspace, one runner per workspace, one run at a time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
| --- | --- | --- |
| I. User-Value Routing First | Pass, with written justification | Mirror of routing ("which task for this expiring quota") using the same inputs; spec Constitution Alignment records the Principle I justification. |
| II. Deterministic Rules Before Complexity | Pass | `evaluateSurplus` is a pure function with named thresholds and a versioned `RULESET_VERSION`; no model decides whether or when a run happens ([contracts/evaluation.md](contracts/evaluation.md)). |
| III. Verifiable Changes and Regression Safety | Pass | One passing and one failing test per FR-007 rule, ordering and tie-break tests, runner idempotence, guardrail and kill-switch tests; before/after scenario in [quickstart.md](quickstart.md). The `getResetInfo` day-basis change ships with a regression test. |
| IV. Explainable Recommendations | Pass | Every evaluation returns inputs, per-rule outcomes and a reason; each run record stores an inputs snapshot (FR-009, FR-020). |
| V. Minimal Dependencies and Privacy | Pass, one exception | No new runtime dependency. Idea text, context and the disposable copy leave the device only on a per-service opt-in plus a runner-side approval tied to content. Exception below. |
| Product Constraint: static frontend without mandatory backend | **Exception (tracked)** | Automatic runs cannot execute in a browser. Mitigated by keeping the runner optional (FR-023). See Complexity Tracking. |
| Workflow: rule changes need before/after scenario | Pass | Scenario in quickstart (60% remaining, reset in 2 days, fresh data, one approved medium idea). |
| Workflow: docs updated with behaviour | Planned | README, `docs/agents/architecture.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `CHANGELOG.md [UNRELEASED]` (tasks phase). |

**Post-design re-check (after Phase 1)**: all gates still pass. The only open item is the tracked exception; no new violation arose from the data model or contracts. Using `routing_config` records avoids a backend schema change, so the shared-state API contract of feature 002 is untouched.

## Project Structure

### Documentation (this feature)

```text
specs/006-surplus-runner/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── verification.md      # Written during implementation (canary result, timing measurements)
├── contracts/
│   ├── evaluation.md        # Pure evaluation + selection contract, rule table
│   ├── shared-records.md    # Record namespaces and payloads in the shared store
│   └── runner-cli.md        # Runner commands, local files, CLI adapter contract
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── data/services.js                    # MODIFIED: add `surplus` block (weeklyQuotaId, sessionQuotaId, tool) to claude and chatgpt
├── utils.js                            # MODIFIED: getResetInfo counts days on the user's local calendar day; quota timestamp key helpers
├── stateTransitions.js                 # MODIFIED: applyQuotaUpdate stamps __ts_{quotaId}; new confirmQuotas(); buildDefaultState seeds null stamps
├── surplus/                            # NEW: pure logic, imported by browser and runner
│   ├── constants.js                    #   defaults, RULESET_VERSION, size classes, status enum
│   ├── time.js                         #   local-day helpers, reset-day start, hard-stop time
│   ├── policy.js                       #   defaults + validation of per-service policy, protected hours
│   ├── ideas.js                        #   create/edit/transition, content fingerprint, approval withdrawal
│   ├── evaluation.js                   #   evaluateSurplus(): rules, selection, ordering, explanation
│   ├── instruction.js                  #   copyable manual instruction builder
│   ├── cycles.js                       #   reset-cycle readings, cycle summary (consumed by runs derived from runs)
│   ├── paths.js                        #   working-folder classification (absolute/relative, refused locations)
│   ├── records.js                      #   logical-key builders/parsers and payload validators for shared records
│   ├── storage.js                      #   pure load/save (storage injected), server-record merge, invalid-record list
│   ├── runs.js                         #   run helpers and result decisions (accept, discard, re-queue)
│   └── *.test.js
├── hooks/
│   ├── useQuotaState.js                # MODIFIED: stamps + confirm action (kept in step with shared hook)
│   ├── useSharedQuotaState.js          # MODIFIED: sync stamp keys like RESET_DATE_KEY
│   └── useSurplusStore.js              # NEW: local-first ideas/policy/runs/cycles + shared sync via routing_config
├── services/sharedStateApi.js          # MODIFIED only if a generic upsert helper is needed
├── components/
│   ├── IdeaCapture.jsx / .module.css   # NEW: 3-interaction capture, context, folder, priority, size
│   ├── IdeaQueue.jsx / .module.css     # NEW: list, edit, reorder, archive, approval-request, awaiting-approval view
│   ├── SurplusNotice.jsx / .module.css # NEW: notice, rule outcomes, copyable instruction, "launched manually"
│   ├── SurplusSettings.jsx / .module.css # NEW: per-service policy, protected hours, calibration, disclosures, global stop
│   ├── RunReview.jsx / .module.css     # NEW: results, accept/discard/requeue, cycle summary
│   └── ServiceCard.jsx                 # MODIFIED: data age + one-action "still current" confirm
└── App.jsx                             # MODIFIED: mount the new sections

runner/                                 # NEW: zero-dependency Node CLI (`npm run runner -- <command>`)
├── index.js                            #   command dispatch: start | approve | status | stop | clean | config
├── config.js                           #   ~/.kairos-runner/config.json load/validate, device id
├── api-client.js                       #   shared-state API calls (list, create, update) with optimistic concurrency
├── approvals.js                        #   local approvals keyed by idea id + SHA-256 content hash; terminal prompt
├── loop.js                             #   tick: heartbeat, pull, evaluate, preflight, claim, run, finalise
├── lease.js                            #   designation (survives expiry) plus single-process lease with heartbeat and expiry
├── workdir.js                          #   folder checks, refusal rules, exclusions, size limit, disposable copy, diff
├── preflight.js                        #   tool present, signed in, no API-key billing env
├── adapters/{claude,codex}.js          #   build argv/env, parse result, usage estimate
├── journal.js                          #   local append-only run journal for restart idempotence
└── *.test.js, fixtures/fake-cli.js

backend/                                # No schema or route change. One contract test for the new record namespaces.
└── tests/contract/surplus-records.contract.test.js   # NEW

docs/, README.md, CHANGELOG.md          # MODIFIED (see Constitution Check)
package.json, eslint.config.js          # MODIFIED: `runner` script, test:runner, lint scope
```

**Structure Decision**: Extend the existing single frontend with a pure `src/surplus/` domain folder (same split as `utils.js` / `stateTransitions.js` / `data/rules.js`), and add a sibling `runner/` Node package-less directory at the repo root (same "no dependencies" posture as `backend/`). The runner imports `../src/surplus/*.js` directly; those modules must not touch `window`, `localStorage` or `import.meta.env`. The backend is deliberately not changed beyond a test, because the runner is a client of the shared-state API like the browser.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Product Constraint "static frontend without mandatory backend": automatic runs require shared mode plus a locally installed runner process | A browser page cannot spawn the user's terminal tools or read local folders, and unattended runs must happen while the browser is closed | Running inside the shared backend rejected: the backend lives on a server where the CLI tools are not signed in and the folders do not exist. Browser-only suggestion mode is kept as the default and fully functional (FR-023, FR-025), so the constraint still holds for everything except the opt-in runner. |
| New top-level `runner/` deliverable (third deployable) | Isolates privileged local execution from the network-facing backend; the only component that can start processes | Embedding in `backend/` would give a LAN-reachable, unauthenticated HTTP surface a path to process execution (see `docs/SECURITY.md`). |
| Reuse of `routing_config` record type for ideas and runs | Avoids rebuilding `shared_records` (CHECK constraint, FKs from `record_revisions`) and a risky migration on live data | Adding new record types needs a table rebuild and breaks "never edit a released migration" ergonomics; namespaced logical keys give the same isolation (see research D6). |
