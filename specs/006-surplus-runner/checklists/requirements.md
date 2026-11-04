# Specification Quality Checklist: surplus-runner

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-31
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Clarification resolved (2026-10-31): FR-017 uses option B. An unattended run works only in a disposable copy of the linked project, and its changes are stored as proposals for review. Options A (read-only drafts) and C (direct modification) were rejected.
- Iteration 1 fixed an ambiguity: "lead time" before protected hours was undefined. It is now expressed as a testable rule (a run MUST NOT start if its maximum duration would reach the protected hours).
- Constitution tension to track in the plan's Complexity Tracking: automatic runs execute outside a static frontend (Product Constraints). Mitigated by FR-023 (the capability stays optional).
- SC-003 and User Story 4 depend on weekly history (feature 005, pending merge).
- Reviewed 2026-11-03 against the codebase (features 001 to 005 merged). Findings fixed in the spec:
  - Weekly history (005) is merged, but its snapshots are calendar-week keyed and updated in place, so they cannot give "quota left at reset". Added FR-032 (reset cycle records); FR-022, US4 and SC-003 now use reset cycles.
  - Quota values carry no timestamp, so the freshness rule of FR-007 had no data. Added FR-031 (reading time, one-action confirm). The session window ages out after 5 hours, so it gets its own limit.
  - Reset dates are date-only, so the 48-hour window and the "30 hours" scenario could not be evaluated. Decision (user, 2026-11-03): whole-day window (default 2 days, matching the feature 004 nudge), reset assumed at the start of the reset day. Optional reset time stays out of scope.
  - Shared-store data routes are not authenticated (docs/SECURITY.md), so a synced "approved" flag could let any LAN client trigger a run. Decision (user, 2026-11-03): approval is valid only when confirmed on the runner device and bound to the exact content (FR-013, FR-029, US3 scenario 7).
  - Added FR-033 (evaluation cadence), the automatic-runs-need-shared-mode rule (FR-023), a quota mapping assumption (weekly and 5-hour quotas per service), a SC-005 rewrite (no "planned work session" concept exists in the app), a local-midnight consistency edge case and a feature 004 coexistence edge case.
  - `.specify/feature.json` pointed at 005-weekly-history; it now points at 006-surplus-runner.
- Unverified: the Assumptions claim that a provider change to non-interactive usage was "reported and then paused in 2026" comes from the original spec and was not checked.
- Amended 2026-11-01: ideas can carry context information and a working folder (FR-026 to FR-030). The idea-level notion is called "working folder" to avoid confusion with the shared Kairos workspace. Approval is withdrawn on any edit (FR-029), and folders are refused or filtered for size, system locations and secrets (FR-030).
