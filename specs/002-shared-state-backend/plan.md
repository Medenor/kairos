# Implementation Plan: Shared State Backend

**Branch**: `[002-shared-state-backend]` | **Date**: 2026-04-14 | **Spec**: [specs/002-shared-state-backend/spec.md](/specs/002-shared-state-backend/spec.md)
**Input**: Feature specification from `/specs/002-shared-state-backend/spec.md`

## Summary

Add a LAN-scoped backend with shared persistence so quota/routing state is consistent across devices, with local-trust LAN access (no login flow), deterministic conflict handling, idempotent migration from browser-local data, and recoverable backups. The design uses a single authoritative API service with transactional storage, explicit sync semantics, and audit-friendly operational events.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node.js 20 LTS for backend and frontend  
**Primary Dependencies**: Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), schema validation library, SQLite driver  
**Storage**: SQLite (WAL mode) for v1 shared persistence, migration metadata, revisions, and backup manifests  
**Testing**: Existing integration shell-script approach plus backend unit/integration tests executed via npm scripts  
**Target Platform**: Self-hosted Linux container runtime on local network, browser clients on same LAN  
**Project Type**: Web application (frontend + backend API service)  
**Performance Goals**: 95% of cross-device updates visible within 5 seconds on LAN; migration success >=99% valid records; out-of-LAN access blocked in 100% security acceptance tests  
**Constraints**: Local-network-only exposure by default, no public remote access, deterministic conflict behavior, retry-safe migration, backup/restore support  
**Scale/Scope**: Small-team/home-office LAN deployment; single backend node; multiple browser clients; state domain focused on quota/routing records

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase 0 Gate

- [x] User-value impact is explicit: shared state improves continuity of quota visibility and routing decisions across devices.
- [x] Recommendation logic is deterministic and traceable, or includes justified fallback behavior.
- [x] Regression safety is defined for behavior changes (automated tests or documented manual verification).
- [x] Explainability is preserved: recommendation reasons and diagnostic inputs are specified.
- [x] Dependency and privacy impact is documented (new runtime deps justified; quota data remains local by default).

### Post-Phase 1 Re-check

- [x] User-value remains explicit in contracts, data model, and quickstart validation flow.
- [x] Deterministic sync and conflict behavior is captured via `expected_version` contract and conflict response schema.
- [x] Regression coverage targets are defined for migration idempotency, sync behavior, access control, and backup recovery.
- [x] Explainability is preserved through migration job status, conflict payloads, and security/change event entities.
- [x] Privacy constraints remain aligned: LAN-scoped deployment, local-trust access model, auditable security events.

## Project Structure

### Documentation (this feature)

```text
specs/002-shared-state-backend/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── shared-state-api.openapi.yaml
└── tasks.md                 # Created by /speckit.tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── api/
│   ├── auth/                 # legacy compatibility module (not required in local-trust mode)
│   ├── db/
│   ├── migrations/
│   ├── services/
│   └── sync/
└── tests/
    ├── integration/
    └── unit/

src/
├── components/
├── data/
├── hooks/
└── services/

tests/
└── integration/
```

**Structure Decision**: Keep the existing frontend in `src/` and introduce a new `backend/` service. This minimizes frontend disruption while adding a clear backend boundary for shared persistence, LAN access control, sync, migration, and backup responsibilities.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New backend runtime dependency | Shared persistence, LAN access control, and backups cannot be delivered with browser-only state | Browser-local storage cannot provide authoritative multi-device state |
| Transactional datastore addition | Conflict-safe writes, migration integrity, and recoverable backups require durable transactions | In-memory or file-only ad hoc state cannot meet consistency and recovery requirements |
