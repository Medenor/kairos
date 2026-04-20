# Research: reset-date-tracking

## Decision 1: Store the last reset date with the existing per-service state

- Decision: Keep reset dates alongside the current per-service state rather than introducing a separate feature store.
- Rationale: The feature is part of the existing service dashboard and should remain scoped to the same user-visible state model.
- Alternatives considered: A separate reset-tracking store or a derived-only UI state. Both would add unnecessary complexity or fail persistence requirements.

## Decision 2: Derive countdowns from explicit service reset cycles

- Decision: Calculate days remaining from a saved reset date plus each service's known reset cycle.
- Rationale: This keeps the output deterministic and easy to explain to users.
- Alternatives considered: Approximate or heuristic countdowns based on usage trends. Rejected because the feature needs a clear, auditable countdown.

## Decision 3: Treat missing reset dates as first-class UI state

- Decision: Show an explicit unset state when a service has no last reset date.
- Rationale: Users need to distinguish "not configured" from "configured but due soon."
- Alternatives considered: Defaulting to zero or hiding the field entirely. Rejected because either option could mislead users.

## Decision 4: Keep the feature local-first with existing sync behavior

- Decision: Preserve the current local-first behavior and reuse the app's existing persistence/sync patterns if shared storage is enabled.
- Rationale: The product already favors local quota state by default and should not introduce new runtime dependencies.
- Alternatives considered: A new external service or a separate network dependency. Rejected because it would add maintenance and privacy overhead without clear user value.

## Decision 5: Use the existing browser and backend test layers

- Decision: Validate the feature through targeted UI behavior checks and existing backend test coverage where persistence changes are involved.
- Rationale: This matches the current project setup and provides regression safety without inventing a new testing stack.
- Alternatives considered: Manual-only verification. Rejected because the feature changes user-visible behavior and needs repeatable coverage.
