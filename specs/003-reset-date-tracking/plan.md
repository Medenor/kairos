# Implementation Plan: reset-date-tracking

**Branch**: `[002-shared-state-backend]` | **Date**: 2026-04-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-reset-date-tracking/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add per-service last-reset-date tracking to the existing quota dashboard so users can record a service's most recent reset and see the remaining days until the next reset. The feature will extend the current service state model, preserve the date alongside other per-service values, and display a clear countdown or unset state in each service card.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: JavaScript (ES Modules), Node.js 20 LTS, React 18, Vite 5  
**Primary Dependencies**: React DOM, existing shared quota state services, existing backend/state sync layer  
**Storage**: Local workspace state with shared persistence already used by the app; reset-date data stored alongside existing service state  
**Testing**: Existing backend test suite and targeted UI verification via current build/test commands  
**Target Platform**: Web application in browser, with optional shared-state backend support  
**Project Type**: Web application  
**Performance Goals**: Date entry and countdown updates should feel instantaneous for the user on save or refresh  
**Constraints**: Preserve offline-friendly local behavior, avoid adding new runtime dependencies unless necessary, keep state deterministic and explainable  
**Scale/Scope**: Per-service tracking for the existing catalog of services and their quota cards

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] User-value impact is explicit: this feature improves routing quality, quota visibility, or decision speed.
- [x] Recommendation logic is deterministic and traceable, or includes justified fallback behavior.
- [x] Regression safety is defined for behavior changes (automated tests or documented manual verification).
- [x] Explainability is preserved: recommendation reasons and diagnostic inputs are specified.
- [x] Dependency and privacy impact is documented (new runtime deps justified; quota data remains local by default).

## Project Structure

### Documentation (this feature)

```text
specs/003-reset-date-tracking/
├── plan.md
├── research.md
├── data-model.md
└── quickstart.md
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── components/
├── hooks/
├── services/
├── data/
└── utils.js

backend/
├── src/
│   ├── api/
│   ├── services/
│   └── migrations/
└── tests/

tests/
└── integration/
```

**Structure Decision**: This feature fits the existing web application structure. The user-facing countdown and date entry live in `src/`, while any persistence needed to keep the data in sync with the shared state model continues to use `backend/` and its existing tests where applicable.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
