# Implementation Plan: reset-aware-recommendations

**Branch**: `004-reset-aware-recommendations` | **Date**: 2026-04-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-reset-aware-recommendations/spec.md`

## Summary

Augment the routing recommendation rules to incorporate per-service reset timing signals derived from the existing `getResetInfo` infrastructure. When two services have comparable quota pressure (within 15 percentage points), the service with the soonest scheduled reset is preferred — spending quota that refreshes sooner has lower long-horizon cost. Due-today and overdue states are treated as distinct signals and surfaced explicitly in recommendation reason text. Services without scheduled resets (`none`) and those without valid reset data (`unset`, `invalid`) fall back to existing quota-only logic unchanged.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node 20 LTS  
**Primary Dependencies**: React 18, Vite 5 (no new runtime dependencies)  
**Storage**: localStorage — existing, via `useQuotaState.js` / `useSharedQuotaState.js`; reset dates already persisted at `state[serviceId][RESET_DATE_KEY]`  
**Testing**: Node.js built-in `node:test` runner (frontend unit tests); Vitest (backend — unaffected by this feature)  
**Target Platform**: Browser (static frontend, offline-capable)  
**Project Type**: Web application — frontend-only scope for this feature  
**Performance Goals**: < 1 ms per recommendation evaluation (pure functions, no I/O)  
**Constraints**: No new runtime dependencies; offline-capable; deterministic output for identical inputs; backward-compatible rule signatures  
**Scale/Scope**: 5 services, 5 task types, 6 reset states (none / unset / invalid / countdown / due / overdue)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **User-value impact is explicit**: reset-aware routing reduces avoidable quota waste and increases decision confidence at the moment of tool selection (Constitution Principle I).
- [x] **Recommendation logic is deterministic and traceable**: reset signals are derived from stored dates via explicit date arithmetic in `getResetInfo`; same quota + reset inputs → same output (Constitution Principle II).
- [x] **Regression safety is defined**: new scenario-based unit tests in `src/utils.reco-reset.test.js` cover all six reset state transitions; existing quota-only paths remain covered by existing tests (Constitution Principle III).
- [x] **Explainability is preserved**: recommendation `reason` string explicitly states when reset timing influenced the outcome; when reset data is unavailable the reason says so (Constitution Principle IV).
- [x] **Dependency and privacy impact is documented**: no new runtime dependencies; reset dates remain in localStorage under the existing `RESET_DATE_KEY` namespace — no new external transmission (Constitution Principle V).

## Project Structure

### Documentation (this feature)

```text
specs/004-reset-aware-recommendations/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── reco-reset.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── utils.js                      # MODIFIED — add getResetSignals()
├── utils.reco-reset.test.js      # NEW — scenario-based tests for reset-aware rules
├── data/
│   └── rules.js                  # MODIFIED — add resetSignals param; update 3 rules
└── components/
    └── RecoBox.jsx               # MODIFIED — compute resetSignals and pass to rule
```

**Structure Decision**: Single project (frontend-only). The feature is a surgical augmentation of three existing files plus one new test file. No new directories or packages are required.

## Constitution Check — Post-Design Re-evaluation

*Confirmed after Phase 1 artifacts are complete.*

- [x] All five gates pass without violations. No complexity tracking entries needed.
- [x] `getResetSignals` is a pure function with no side effects — Constitution II upheld.
- [x] Rule functions remain pure and testable in isolation — Constitution III upheld.
- [x] Reason strings are generated from explicit inputs visible to the developer — Constitution IV upheld.
