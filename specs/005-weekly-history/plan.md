# Implementation Plan: weekly-history

**Branch**: `005-weekly-history` | **Date**: 2026-04-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/Users/raphael/Programmation/kairos/specs/005-weekly-history/spec.md`

## Summary

Add local-first weekly quota history by recording one canonical snapshot per user workspace and local calendar week. The snapshot captures the latest known per-service quota state for that week, updates in place during the same week, retains at least 52 completed weeks, and exposes service-by-service review data that distinguishes missing history from zero consumption. The implementation extends the existing quota state hooks and optional shared-state backend record model without adding runtime dependencies or changing current quota values.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node.js 20 LTS  
**Primary Dependencies**: React 18, React DOM 18, Vite 5, existing shared-state API client and backend services (no new runtime dependencies)  
**Storage**: localStorage for local-first state; optional SQLite-backed shared records through existing `record_type='snapshot'` support for workspace-scoped sync  
**Testing**: Node.js built-in `node:test` for frontend utilities; backend `node --test` contract/integration tests where shared snapshot persistence is touched  
**Target Platform**: Browser static frontend with optional LAN shared-state backend  
**Project Type**: Web application with frontend-local state and optional backend persistence  
**Performance Goals**: Snapshot write/update completes during normal quota-state persistence without visible UI delay; history derivation for the current service catalog stays under 16 ms for a 52-week review range on typical client hardware  
**Constraints**: No new runtime dependencies; offline-capable; deterministic local calendar-week keys; preserve current quota values when recording or displaying history; keep quota history scoped to the active workspace  
**Scale/Scope**: Existing service catalog (5 services), all quota fields plus reset-date metadata, at least 52 completed weekly snapshots plus the current week, one active workspace at a time

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **User-value impact is explicit**: weekly history improves quota visibility and reduces decision latency by showing consumption patterns over time (Constitution Principle I).
- [x] **Recommendation logic is deterministic and traceable**: this feature does not change routing recommendations; snapshot keys and history gaps are derived from explicit local-week rules (Constitution Principle II).
- [x] **Regression safety is defined**: scenario-based tests will cover week-key generation, same-week updates, retention, gap handling, removed-service preservation, and no mutation of current quota state (Constitution Principle III).
- [x] **Explainability is preserved**: review data exposes raw weekly values, missing-week gaps, and insufficient-history states rather than opaque inferred trends (Constitution Principle IV).
- [x] **Dependency and privacy impact is documented**: no new runtime dependencies; weekly snapshots remain in local workspace storage and optional LAN shared persistence only (Constitution Principle V).

## Project Structure

### Documentation (this feature)

```text
specs/005-weekly-history/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── weekly-history.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── App.jsx                         # MODIFIED - render weekly history review surface
├── components/
│   ├── WeeklyHistoryPanel.jsx      # NEW - service history review and gap messaging
│   └── WeeklyHistoryPanel.module.css
├── hooks/
│   ├── useQuotaState.js            # MODIFIED - record local weekly snapshots with localStorage fallback
│   └── useSharedQuotaState.js      # MODIFIED - sync snapshot records through existing shared-state API
├── services/
│   ├── localExport.js              # MODIFIED - include weekly history in export/import mapping if export covers app state
│   └── sharedStateApi.js           # MODIFIED only if helper wrappers are needed for snapshot records
├── data/
│   └── services.js                 # READ - service catalog used to label historical series
├── utils.js                        # MODIFIED - week-key, clone, retention, and series derivation helpers
├── utils.weekly-history.test.js    # NEW - pure utility and scenario tests
└── weekly-history.integration.test.js # OPTIONAL - if UI/state behavior is tested outside pure utilities

backend/
├── src/
│   └── migrations/001_initial_schema.sql # READ - existing `snapshot` record_type already supports shared snapshots
└── tests/
    ├── contract/shared-state-api.contract.test.js # MODIFIED if snapshot contract coverage is missing
    └── integration/us1-shared-sync.test.js        # MODIFIED if shared weekly-history sync is implemented
```

**Structure Decision**: Keep the feature in the existing single React app under `src/`, with optional backend interaction through the already implemented shared-record API. The backend schema already allows `record_type='snapshot'`, so weekly history should reuse that generic record model instead of adding a new table or dependency.

## Complexity Tracking

No Constitution violations. No complexity exceptions required.

## Constitution Check - Post-Design Re-evaluation

*Confirmed after Phase 1 artifacts are complete.*

- [x] Phase 1 artifacts preserve local-first behavior and workspace privacy boundaries.
- [x] Contracts require deterministic week keys and explicit gap states.
- [x] Data model keeps current quota state separate from immutable historical values copied into snapshots.
- [x] No new dependencies, external services, or recommendation behavior changes are introduced.
