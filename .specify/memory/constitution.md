<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0 (MINOR: materially expanded mandate, 2026-11-04, feature 007-dynamic-providers)
- Modified sections:
  - Product Constraints: the named scope (Claude, ChatGPT, Copilot, pay-as-you-go APIs)
    is replaced by user-declared providers with no shipped list; quota input modes are
    declared per quota of each provider instead of "mapped per service"
- Principles I to V: unchanged
- Migration notes for active templates:
  - .specify/templates/plan-template.md, spec-template.md, tasks-template.md,
    checklist-template.md, agent-file-template.md checked: none names the former
    provider scope or the "mapped per service" wording, so no template change is required
  - Existing specs 001 to 006 keep their wording; they describe the fixed-provider
    versions of the product and are not rewritten
- Previous report (1.0.0):
- Version change: template -> 1.0.0
- Modified principles:
  - Principle 1 template slot -> I. User-Value Routing First
  - Principle 2 template slot -> II. Deterministic Rules Before Complexity
  - Principle 3 template slot -> III. Verifiable Changes and Regression Safety
  - Principle 4 template slot -> IV. Explainable Recommendations and Observability
  - Principle 5 template slot -> V. Minimal-Dependency Frontend and Privacy-by-Default
- Added sections:
  - Product Constraints
  - Development Workflow & Quality Gates
- Removed sections:
  - None
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ⚠ pending: .specify/templates/commands/*.md (directory not present in this repository)
- Deferred TODOs:
  - None
-->
# Kairos Constitution

## Core Principles

### I. User-Value Routing First
All product decisions MUST improve users' ability to choose the right AI service at the
moment of use. Features MUST deliver direct routing value, quota visibility, or reduced
decision latency. Work that does not improve user decision quality or speed MUST be
rejected or explicitly justified in writing before implementation.
Rationale: Kairos exists to support real-time tool selection under quota constraints,
not to maximize feature count.

### II. Deterministic Rules Before Complexity
Routing recommendations MUST be reproducible from explicit, version-controlled rules.
Rule changes MUST be traceable to user-visible outcomes. Heuristic or model-driven
recommendation logic MAY be introduced only when deterministic rules are insufficient,
and only with a documented fallback path to deterministic behavior.
Rationale: Reproducibility and debuggability are essential for user trust.

### III. Verifiable Changes and Regression Safety
Behavior-changing changes MUST include verification that would fail if behavior regresses.
This is normally automated tests; for UI-only behavior, documented manual verification is
acceptable when automation is disproportionate. Bug fixes MUST include a regression check.
No behavior-changing change may be merged without evidence of verification.
Rationale: Recommendation quality erodes quickly without explicit regression controls.

### IV. Explainable Recommendations and Observability
Every recommendation surfaced to users MUST include a concise reason based on known
inputs (quota state, task type, and rule outcome). The system MUST preserve enough local
state and diagnostics to explain why a recommendation was made and to reproduce it during
review. Silent or opaque recommendation changes are prohibited.
Rationale: Explainability is required for trust, debugging, and iterative improvement.

### V. Minimal-Dependency Frontend and Privacy-by-Default
Kairos MUST remain lightweight and dependency-disciplined. New runtime dependencies MUST
be justified against bundle and maintenance impact. Quota and usage state MUST default to
local-only storage; transmitting user quota data externally requires explicit user action
and clear disclosure.
Rationale: A small, privacy-respecting tool is easier to maintain and safer to adopt.

## Product Constraints

- The canonical product scope is quota-aware routing across the AI providers the user
  declares (subscriptions with percentage quotas and pay-as-you-go balances); the
  application MUST NOT ship a fixed provider list.
- Supported quota input modes MUST remain explicit (`consumed_pct`,
  `remaining_pct`, `currency`) and be declared per quota of each provider.
- Recommendations MUST be available without network dependency for core operation.
- The application MUST function as a static frontend deployable without mandatory backend
  services.

## Development Workflow & Quality Gates

- Specs, plans, and tasks produced in `.specify/` MUST include explicit Constitution
  alignment checks before implementation begins.
- Pull requests MUST document behavior changes, verification evidence, and any dependency
  additions.
- Changes to routing rules MUST include at least one scenario demonstrating before/after
  recommendation behavior.
- Documentation affecting user decisions (README, quickstart, rule docs) MUST be updated
  in the same change when behavior is altered.

## Governance

This Constitution supersedes ad hoc development preferences for this repository.

- Amendment process: proposals MUST be submitted via pull request, include impacted
  principles/sections, and include migration notes for active templates when required.
- Versioning policy:
  - MAJOR for incompatible governance changes or principle removals/redefinitions.
  - MINOR for new principles/sections or materially expanded mandates.
  - PATCH for clarifications and non-semantic wording improvements.
- Compliance review: every feature plan and pull request MUST include a Constitution
  compliance check; unresolved violations MUST be tracked in a Complexity Tracking or
  equivalent exceptions section before approval.

**Version**: 1.1.0 | **Ratified**: 2026-04-14 | **Last Amended**: 2026-11-04
