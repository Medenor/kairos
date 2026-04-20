# Data Model: reset-date-tracking

## Service Reset State

Represents the reset tracking data for one service.

- `serviceId`: Identifier for the service being tracked.
- `lastResetDate`: The most recent date the user entered for that service.
- `resetCycleDays`: The service's configured reset interval in days.
- `nextResetDate`: Derived date based on `lastResetDate` and `resetCycleDays`.
- `daysRemaining`: Derived whole-day countdown shown to the user.

### Relationships

- One service has one reset state.
- Reset state is independent across services.

### Validation Rules

- `lastResetDate` must be a valid date when present.
- `resetCycleDays` must be defined for countdown display.
- `daysRemaining` must never be negative in the displayed state.
- If `lastResetDate` is missing, the state is considered unset rather than overdue.

### State Transitions

- Unset -> Set when a user saves a valid last reset date.
- Set -> Updated when a user changes the date.
- Set -> Unset when a user clears the date.
- Set -> Overdue when the calculated next reset date is on or before the current day.
