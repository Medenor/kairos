# Frontend Conventions

React 18 + Vite 5, plain JavaScript (ES modules, Node 20+ baseline), CSS Modules. No UI library, no state library, no TypeScript.

## Rules

- **Runtime dependencies stay at `react` + `react-dom`.** Adding one needs written justification (bundle and maintenance impact) per constitution principle V.
- **Logic lives outside components.** Quota math, reset handling, weekly history and state transitions are pure functions in `src/utils.js` and `src/stateTransitions.js`. Components render; hooks wire.
- **Routing rules are pure and deterministic** (`src/data/rules.js`): `(state, ...) -> { primary, reason, alts }`. Every recommendation must carry a human-readable `reason`. No `Date.now()` inside a rule: pass `now` in so tests are reproducible.
- **Offline first.** Anything that works locally must keep working when the backend is unreachable. Never make a recommendation depend on the network.
- **One CSS Module per component** (`Component.jsx` + `Component.module.css`). No global class names outside `src/index.css`.
- **Keep both hooks in step.** `useQuotaState` and `useSharedQuotaState` share `stateTransitions.js`; a behavior change in one almost always belongs in both.
- Adding a service or quota: edit `src/data/services.js` (and the rule that uses it), then add a test.
- No `console.log` in committed frontend code; no hardcoded API URLs (use `VITE_SHARED_API_BASE_URL`, see [DEPLOYMENT.md](../DEPLOYMENT.md)).

## Hook rules

ESLint enforces `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps` (warning). There are three known `exhaustive-deps` warnings in `useSharedQuotaState.js`; do not add new ones.

## Checks

```bash
npm run lint && npm run test:frontend && npm run build
```
