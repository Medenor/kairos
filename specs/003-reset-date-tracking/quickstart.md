# Quickstart: reset-date-tracking

## Purpose

Verify that per-service reset dates can be entered, persisted, and displayed as a countdown.

## Verification Steps

1. Start the app using the existing development workflow (`npm run backend:migrate`, `npm run backend:start`, `npm run dev`).
2. Open the service dashboard.
3. Enter a last reset date for one service and confirm the card shows a countdown label (for example, `Xd until next reset`).
4. Refresh the page and confirm the same date and countdown state are preserved.
5. Enter an older date for another service and confirm the card shows an overdue state.
6. Clear the date and confirm the card returns to `Last reset date not set`.
7. Repeat for a second service and confirm reset-date values remain independent per service.
8. Run verification commands:
   - `node --test src/utils.reset.test.js`
   - `npm test`
   - `npm run lint`

## Expected Result

Each service displays one deterministic state (`countdown`, `due today`, `overdue`, or `unset`) based on its saved reset date and reset cycle, and values persist across refresh/sync.
