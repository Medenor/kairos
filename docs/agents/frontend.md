# Frontend Conventions

React 18 + Vite 5, plain JavaScript (ES modules, Node 20+ baseline), CSS Modules. No UI library, no state library, no TypeScript.

## Rules

- **Runtime dependencies stay at `react` + `react-dom`.** Adding one needs written justification (bundle and maintenance impact) per constitution principle V.
- **Logic lives outside components.** Quota math, reset handling, weekly history and state transitions are pure functions in `src/utils.js` and `src/stateTransitions.js`. Components render; hooks wire.
- **Routing rules are pure and deterministic** (`src/data/rules.js`): `(state, ...) -> { primary, reason, alts }`. Every recommendation must carry a human-readable `reason`. No `Date.now()` inside a rule: pass `now` in so tests are reproducible.
- **Offline first.** Anything that works locally must keep working when the backend is unreachable. Never make a recommendation depend on the network.
- **One CSS Module per component** (`Component.jsx` + `Component.module.css`). No global class names outside `src/index.css`.
- **Surplus logic lives in `src/surplus/` and stays pure.** It is imported by `runner/`, so no `window`, `localStorage`, `import.meta.env` or `Date.now()` there: inject `now`, ids and storage. The runner process imports it from Node.
- **Keep both hooks in step.** `useQuotaState` and `useSharedQuotaState` share `stateTransitions.js`; a behavior change in one almost always belongs in both.
- Adding a service or quota: edit `src/data/services.js` (and the rule that uses it), then add a test.
- No `console.log` in committed frontend code; no hardcoded API URLs (use `VITE_SHARED_API_BASE_URL`, see [DEPLOYMENT.md](../DEPLOYMENT.md)).

## Surplus feature (006)

`useSurplusStore` (`src/hooks/useSurplusStore.js`) is the only hook the surplus UI uses. It is a thin edge over `src/surplus/engine.js`: it injects `localStorage`, the clock, id generation, the shared-state API client and the workspace id, and exposes one immutable snapshot (`ideas`, `policy`, `runs`, `cycles`, `control`, `lease`, `invalid`, `evaluation`, `syncStatus`, ...) plus stable actions (`addIdea`, `updateIdea`, `requestApproval`, `markLaunchedManually`, `decideRun`, `updatePolicy`, `stopAutoRuns`, ...). The full list is in the header comment of the hook. `App.jsx` calls `useSurplusStore({ workspaceId, quotaState: state })`.

- **Engine/store split.** Pure state operations are in `surplus/store.js` (return `{ok, state}` or `{ok:false, error:{field, code, message}}`, never mutate). The imperative engine (`surplus/engine.js`) adds persistence, debounce (220 ms), pull and conflict handling and runs under `node:test` with a fake API. New behavior goes in `store.js`/`engine.js` with a test, not in the hook.
- **Local first.** Every action writes memory and `localStorage` synchronously; the queue, evaluation and manual instruction work with no backend. Automatic runs need shared mode and a runner; the UI says so when no workspace is set.
- **`evaluation` is derived, never stored.** Computed with `useMemo` in `preview` mode (`folderChecks` is `null`: a browser cannot check folders), refreshed every 60 s while the page is visible.
- **Display-only runner state.** `approvalRequested` and the lease's `approved` map are shown by `IdeaQueue` (via `surplus/runnerState.js`) but are never an authorisation; approval happens only on the runner device. Do not add a control that implies otherwise.
- **Component props.** Components are presentational and take data plus callbacks that return `{ok, ...}` (the hook actions): `IdeaCapture({onAdd, sharedMode})`, `IdeaQueue({ideas, invalid, lease, actions})`, `SurplusNotice({evaluation, ideas, services, onMarkLaunched, onConfirmQuotas, lease})`, `SurplusSettings({policy, onUpdatePolicy, services, sharedMode, autoRunEnabled, onStopAutoRuns, onSetAutoRunEnabled})`, `RunReview({runs, ideas, onDecision})`, `CycleSummary({cycles, runs, services, now?})`. Each has a header comment with the exact props; `now` is an optional prop for reproducible output. Run output and diffs render as text nodes only, never HTML.
- `ServiceCard` shows the age of each reading and a one-action "still current" confirm (`onConfirm`, `confirmQuotas` in `stateTransitions.js`).
- In shared mode the idea form shows, once, a notice that the store is readable by the LAN (`SHARED_STORE_NOTICE`); the queue does not repeat it.

## Hook rules

ESLint enforces `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps` (warning). There are three known `exhaustive-deps` warnings in `useSharedQuotaState.js`; do not add new ones.

## Checks

```bash
npm run lint && npm run test:frontend && npm run build
```
