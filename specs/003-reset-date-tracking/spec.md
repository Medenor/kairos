# Feature Specification: reset-date-tracking

**Feature Branch**: `[003-reset-date-tracking]`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: User description: "Reset date tracking — enter the last reset date per service, display days remaining until the next reset"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track Last Reset Date (Priority: P1)

As a user, I can record the most recent reset date for each service so I can keep my quota timing accurate.

**Why this priority**: Capturing the last reset date is the core input needed for all reset countdowns.

**Independent Test**: Enter a reset date for a service and confirm it is saved and shown again later for that same service.

**Acceptance Scenarios**:

1. **Given** a service with a known reset cycle, **When** I enter the last reset date, **Then** the service stores that date as the current reset reference.
2. **Given** a service already has a last reset date, **When** I update it, **Then** the new date replaces the previous one.

---

### User Story 2 - Show Countdown (Priority: P2)

As a user, I can see how many days remain until the next reset for each service so I can plan usage.

**Why this priority**: The countdown is the main value of the feature once the reset date is known.

**Independent Test**: Set a last reset date and verify the displayed remaining days matches the expected service reset cycle.

**Acceptance Scenarios**:

1. **Given** a saved last reset date and a defined reset cycle, **When** I view the service, **Then** I see the number of days remaining until the next reset.
2. **Given** the next reset date has already passed, **When** I view the service, **Then** I see that the service is due for reset now or is overdue.

---

### User Story 3 - Handle Missing Data (Priority: P3)

As a user, I can recognize services that do not yet have a reset date so I know which ones still need setup.

**Why this priority**: Missing dates should not block the feature, but they must be visible to avoid misleading countdowns.

**Independent Test**: Open a service without a saved date and confirm the UI clearly indicates that the reset date is not set.

**Acceptance Scenarios**:

1. **Given** a service with no saved reset date, **When** I view it, **Then** I see a clear empty-state message instead of a countdown.
2. **Given** a service with a reset date removed, **When** I view it again, **Then** the countdown disappears and the service is marked as unset.

### Edge Cases

- A reset date in the future is treated as invalid and must not produce a negative countdown.
- The same reset date entered for multiple services is tracked independently per service.
- Services with different reset cycles must each calculate remaining days from their own cycle.
- If the current day is the reset day, the remaining time is shown as zero days.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow users to enter and update the last reset date for each service independently.
- **FR-002**: The system MUST persist the last reset date so that it remains available after the user returns to the feature.
- **FR-003**: The system MUST display the number of days remaining until the next reset for each service with a saved reset date.
- **FR-004**: The system MUST calculate the next reset from the saved last reset date and the service’s configured reset cycle.
- **FR-005**: The system MUST clearly indicate services that do not yet have a saved reset date.
- **FR-006**: The system MUST prevent invalid reset-date entries from being saved.
- **FR-007**: The system MUST update the remaining-day display when a user changes a service’s last reset date.
- **FR-008**: The system MUST keep each service’s reset tracking separate from other services.

### Key Entities *(include if feature involves data)*

- **Service Reset Profile**: A service and its reset cycle, used to determine when the next reset is due.
- **Last Reset Date**: The most recent date the user recorded for a service.
- **Reset Countdown**: The displayed number of days remaining until the next reset, derived from the service reset profile and last reset date.

## Constitution Alignment *(mandatory)*

- **User Value**: Helps users avoid missing quota resets and makes service planning faster and more reliable.
- **Determinism**: Remaining days are derived from a saved reset date and a defined reset cycle using explicit date rules.
- **Verification Plan**: Validate date entry, persisted retrieval, and countdown display with scenarios covering set, update, missing, and overdue states.
- **Explainability**: Each service shows its recorded reset date state and the resulting remaining-day count in a user-visible way.
- **Dependency & Privacy Impact**: Adds user-entered service timing data that should remain scoped to the user’s workspace and be handled with the same privacy expectations as other service preferences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can record or update a service reset date in under 30 seconds for at least 95% of attempts.
- **SC-002**: At least 90% of users can correctly identify which services are due for reset after viewing the countdown display.
- **SC-003**: Services with saved reset dates always show a remaining-day value or an overdue state, with no blank countdowns.
- **SC-004**: Users can return later and see the same last reset date and countdown state for the same service in 100% of persistence checks.

## Assumptions

- Each service has a defined reset cycle that is already known to the product.
- The feature is scoped to per-service tracking and does not attempt to manage account-wide or organization-wide reset schedules.
- Dates are shown in the user’s local calendar context unless a service-specific rule requires otherwise.
- If a service has no known reset cycle, the feature can still store the last reset date but may not show a countdown.
