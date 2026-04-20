# Quickstart: reset-date-tracking

## Purpose

Verify that per-service reset dates can be entered, persisted, and displayed as a countdown.

## Verification Steps

1. Start the app using the existing development workflow.
2. Open the service dashboard.
3. Enter a last reset date for one service.
4. Refresh the page and confirm the same date is still present.
5. Confirm the service now shows days remaining until the next reset.
6. Repeat for another service and confirm the values are tracked independently.
7. Clear or remove a date and confirm the service returns to the unset state.

## Expected Result

Each service displays either a valid remaining-day countdown or a clear unset state, and the values remain stable after reloads.
