# Feature Specification: reset-aware-recommendations

**Feature Branch**: `[004-reset-aware-recommendations]`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: User description: "Recommendation logic should take reset date tracking into account"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recommend With Reset Timing (Priority: P1)

As a user, I want recommendations to account for reset timing so I can avoid spending scarce quota when a reset is near.

**Why this priority**: This is the core value request and directly improves decision quality at the moment of tool selection.

**Independent Test**: Set comparable quota pressure across services, set different reset timing, and confirm the recommendation changes according to reset proximity.

**Acceptance Scenarios**:

1. **Given** two eligible services with similar pressure, **When** one service is close to reset and the other is not, **Then** the recommendation prefers the option that better preserves long-horizon quota.
2. **Given** a service is overdue or due today for reset, **When** the user asks for a recommendation, **Then** the recommendation reason explicitly references reset timing impact.

---

### User Story 2 - Explain Reset Influence (Priority: P2)

As a user, I want to understand how reset timing affected the recommendation so I can trust and validate the outcome.

**Why this priority**: Explainability is required for confidence and aligns with the product constitution.

**Independent Test**: Trigger a recommendation where reset timing is decisive and verify the explanation states how reset timing influenced the choice.

**Acceptance Scenarios**:

1. **Given** reset timing changes the selected service, **When** the recommendation is displayed, **Then** the explanation states the reset-based rationale in plain language.
2. **Given** reset timing is unavailable for a service, **When** the recommendation is displayed, **Then** the explanation indicates that reset timing was not used for that service.

---

### User Story 3 - Safe Fallback Behavior (Priority: P3)

As a user, I want stable recommendations even when reset dates are missing or invalid so the system remains usable without configuration friction.

**Why this priority**: Missing or invalid reset dates are expected during adoption and should not degrade core routing reliability.

**Independent Test**: Clear or invalidate reset dates and verify recommendations still resolve with predictable fallback behavior.

**Acceptance Scenarios**:

1. **Given** reset date data is missing for one or more services, **When** a recommendation is requested, **Then** the system falls back to quota-based logic without error.
2. **Given** reset date data is invalid or future-dated, **When** a recommendation is requested, **Then** the system ignores invalid timing signals and returns a deterministic result.

### Edge Cases

- Multiple services have the same reset timing and similar quota pressure.
- A service has no scheduled reset window and only manual top-up behavior.
- A reset date is due today and quota pressure is simultaneously critical.
- A previously valid reset date becomes invalid after user update.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST incorporate reset timing signals into recommendation selection when valid reset data exists.
- **FR-002**: The system MUST keep recommendation outcomes deterministic for the same quota, task, and reset inputs.
- **FR-003**: The system MUST provide recommendation explanations that explicitly state when reset timing influenced the outcome.
- **FR-004**: The system MUST preserve existing quota-based recommendation behavior as a fallback when reset timing data is missing or invalid.
- **FR-005**: The system MUST treat due-today and overdue reset states as distinct timing signals in recommendation evaluation.
- **FR-006**: The system MUST avoid using reset timing for services that do not have scheduled reset cycles.
- **FR-007**: The system MUST ensure recommendation output remains available for all task types regardless of reset-data completeness.
- **FR-008**: The system MUST apply reset-aware logic consistently across manual and persisted state updates.

### Key Entities *(include if feature involves data)*

- **Reset Timing Signal**: A normalized timing state derived from each service reset profile (countdown, due today, overdue, unavailable).
- **Recommendation Decision Context**: The combined input set used for routing decisions, including quota pressure, task type, and reset timing.
- **Recommendation Rationale**: User-visible reason text that explains why the selected service was chosen, including reset influence when applicable.

## Constitution Alignment *(mandatory)*

- **User Value**: Improves routing quality by preventing avoidable quota waste and increasing decision confidence.
- **Determinism**: Recommendation outcomes remain traceable to explicit quota and reset timing states with stable fallback behavior.
- **Verification Plan**: Validate decision changes and fallback behavior through scenario-based checks covering countdown, due, overdue, missing, and invalid states.
- **Explainability**: Recommendation rationale communicates whether reset timing was used, ignored, or unavailable.
- **Dependency & Privacy Impact**: Uses existing local quota/reset data and does not introduce new external data dependencies.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least 95% of defined routing scenarios, recommendation outcomes match expected reset-aware decision rules.
- **SC-002**: In 100% of scenarios where reset timing changes a recommendation, the explanation explicitly mentions reset timing impact.
- **SC-003**: In 100% of scenarios with missing or invalid reset data, recommendations still return a valid service selection.
- **SC-004**: Users complete a recommendation review and can identify why reset timing affected the result in under 20 seconds for at least 90% of observed sessions.

## Assumptions

- Reset date tracking remains a per-service user-managed input.
- Existing quota pressure logic remains the baseline and is only augmented by reset timing signals.
- Services without scheduled reset cycles continue to rely on quota and balance signals alone.
- Recommendation behavior changes are evaluated against deterministic scenario fixtures before release.
