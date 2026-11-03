# Development Workflow and Pitfalls

## Workflow

1. Read the feature's `specs/NNN-*/spec.md` and the code plus tests you will touch. Tests document expected behavior.
2. New feature? Use the spec-kit flow: `/speckit-specify` -> `/speckit-plan` -> `/speckit-tasks` -> `/speckit-implement` -> `/speckit-converge`. Small fixes and chores do not need a spec.
3. Check the plan against the constitution (`.specify/memory/constitution.md`): routing value, deterministic rules, verification, explainability, minimal dependencies.
4. Implement with tests alongside (see [testing.md](testing.md)).
5. Before opening a PR: `npm run lint && npm test && npm run build`.
6. Update `CHANGELOG.md`, the feature spec, and any doc whose behavior you changed.

## Pitfalls

- **Do not store derived data in state.** Compute pressure, reset info and recommendations from state on render.
- **`remaining_pct` is inverted.** ChatGPT quotas are "remaining"; use `getConsumedPct(quota, value)`, never compare raw values across quota types.
- **Overdue resets** (`daysRemaining < 0`) are excluded from tiebreakers on purpose; see `resetTiebreaker` in `rules.js`.
- **Weekly snapshots are not quota state.** `applyQuotaRecord` ignores non-`quota_state` records so a synced snapshot can never overwrite live values. Keep it that way.
- **Missing is not zero.** Weekly history shows explicit gaps for missing weeks/services; never default them to 0%.
- **Local week = Monday start, local time.** Use `getLocalWeekKey`; do not build week keys by hand.
- **SQL strings:** every dynamic backend value goes through `quoteSql()`. See [backend.md](backend.md).
- **`sqlite3` CLI required** for the backend and its tests.
- **Ports differ by mode:** direct run is backend `8080` / frontend `5173`; the dev compose stack publishes `8888` / `5273`. The frontend probes `8888` then `8080` unless `VITE_SHARED_API_BASE_URL` is set.
- **`AGENTS.md` is partly generated** by `.specify/scripts/bash/update-agent-context.sh`. Edit only inside the `MANUAL ADDITIONS` block; the rest is rewritten from feature plans.
- **Never edit an already-applied SQL migration**; add a new one.
