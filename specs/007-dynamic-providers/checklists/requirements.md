# Specification Quality Checklist: dynamic-providers

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-01
**Revised**: 2026-11-04 (reconciled with implemented features 005-weekly-history and 006-surplus-runner)
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

- Decisions taken with the user before writing (2026-11-01): generic rules driven by declared attributes (option A), editable attributes as proposed, fresh empty base with no defaults and no import of legacy live data, fixed task list, branch created from `main`, with 006 implemented first.
- Revision 2026-11-04, conflicts found between the first draft and the delivered 005/006, and how the spec now resolves them:
  - Deleting a provider was said to remove its history; 005 FR-007 requires snapshots of removed services to be preserved. Now: history and run records are kept and shown as removed (FR-004, FR-028, FR-036).
  - 006 breaks surplus ties by display order; 007 FR-014 forbids order from influencing outcomes. Now: one order-independent criterion for both (FR-034), recorded as a possible intended difference.
  - "Legacy data not displayed" collided with weekly snapshots, run and cycle records already written. Now: live data of former providers is ignored, history records stay readable and read-only as removed providers, and a same-name new provider inherits nothing (FR-022, FR-023).
  - 006 supports two named services whose weekly quota, session window and terminal tool are written into the catalogue; the runner reads that catalogue from source. Now: surplus is a per-provider profile (FR-031 to FR-033) and the runner learns providers from the shared store but never lets them authorise a run (FR-035).
  - Per-service surplus settings and the runner allow-list were keyed by fixed names. Now: keyed by provider identity, off for every new or duplicated provider (FR-010, FR-033).
- Decision to confirm with the user: keeping the history records of former fixed providers readable (rather than hidden) is a change from the first draft's "not displayed". It follows 005/006 and avoids data loss; hiding them instead would only change FR-022 and one edge case.
- Open points deliberately deferred to planning (documented in Assumptions): the scale and combination of task fit with quota pressure, currency-to-pressure normalisation, the order-independent tie-break criterion, and the exact changes to stored 005/006 data and to the runner.
- Constitution: the canonical-scope wording of Product Constraints needs a minor amendment (see Constitution Alignment).
- Validation: 1 iteration, all items pass.
