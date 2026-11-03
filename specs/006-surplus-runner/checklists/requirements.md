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
- Amended 2026-11-01: ideas can carry context information and a working folder (FR-026 to FR-030). The idea-level notion is called "working folder" to avoid confusion with the shared Kairos workspace. Approval is withdrawn on any edit (FR-029), and folders are refused or filtered for size, system locations and secrets (FR-030).
