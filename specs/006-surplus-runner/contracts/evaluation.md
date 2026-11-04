# Contract: surplus evaluation (pure)

Module: `src/surplus/evaluation.js`. Importable by the browser and the runner. No `Date.now()`, no `window`, no `localStorage`, no `fetch`, no `fs`.

```js
evaluateSurplus({
  now,            // Date, injected
  state,          // quota state incl. __last_reset_date and __ts_* keys
  services,       // SERVICES (uses svc.surplus.{weeklyQuotaId, sessionQuotaId, tool})
  policy,         // Surplus Policy
  ideas,          // Idea[]
  runs,           // Run[] (for once-per-cycle retry and running-folder exclusion)
  folderChecks,   // { [ideaId]: { ok: bool, code?: string } } | null  (null in the browser)
  mode,           // 'preview' | 'auto'   ('auto' also requires approvals, see runner)
}) -> Evaluation
```

## Evaluation (result)

```js
{
  rulesetVersion: 1,
  evaluatedAt: ISO,
  services: [{
    serviceId, eligible: bool,
    inputs: { daysToReset, nextResetDate, weeklyRemainingPct, sessionRemainingPct,
              weeklyAgeHours, sessionAgeHours, reservePct, windowDays, ... },
    rules: [{ id, pass: bool, detail: string }],     // fixed order R1..R7
    candidate: { ideaId, size, costPct, reason } | null,
    skipped: [{ ideaId, reason }],                    // e.g. folder_not_found, retry_used, running_elsewhere
    reason: string                                    // human-readable, always present
  }],
  selected: { serviceId, ideaId, alternatives: [serviceId] } | null,
  reason: string                                      // why selected or why nothing (never empty)
}
```

Same input must give a deep-equal output (SC-002). `Evaluation` is stored verbatim in `Run.decisionInputs`.

## Rules (FR-007), evaluated in this order, all must pass

| Id | Rule | Fails when |
| --- | --- | --- |
| R1 | `policy.services[id].surplusEnabled` | off |
| R2 | Reset known and in window: `getResetInfo` state is `countdown` and `1 <= daysRemaining <= windowDays` | unset, invalid, future, due today, overdue, or beyond the window |
| R3 | Weekly data fresh: `now - __ts_weekly <= freshnessHours` | stamp null or older |
| R4 | Weekly room: `weeklyRemainingPct >= reservePct + costPct(size)` for the candidate | below (reported per candidate; the service is eligible if at least one idea fits) |
| R5 | Session reading fresh and roomy: `now - __ts_session <= sessionMaxAgeHours` and `sessionRemainingPct >= sessionMinRoomPct` | stale, null or too low |
| R6 | Time bound: `now + maxRunMinutes` is before both the next protected-hours start and the local start of the reset day | would reach either |
| R7 | At least one waiting idea passes folder and retry checks | none |

For `mode: 'auto'` the runner adds guardrails outside this pure function: `autoRunEnabled` for the service, `control.autoRunEnabled`, local `allowServices`, `allowCodexAuto` for a Codex service (skip reason `codex_reads_uncontained`), lease held, no other active run, local approval hash equal. Each failure is recorded with a reason; none can be bypassed by data in the shared store.

## Selection (FR-008)

1. Eligible services sorted by soonest `daysToReset`, then by `SERVICES` order. Others become `alternatives`.
2. Within the first service: waiting ideas, skipping `folderChecks[id].ok === false` (reason recorded), ideas with an auto run in this `cycleKey` that failed or was interrupted (retry used), and ideas whose `resolvedFolder` equals that of a currently running idea.
3. Order: priority `high > normal > low`, then the largest size class whose `costPct <= weeklyRemainingPct - reservePct`, then oldest `createdAt`, then `id` for total determinism.
4. If the first service has no usable idea, the next eligible service is tried.

## Time helpers (`src/surplus/time.js`)

- `resetDayStart(nextResetDate)` returns the local midnight `Date` of that date.
- `nextProtectedStart(protectedHours, now)` returns the next local start, or `null`.
- `hardStopAt(now, policy, nextResetDate)` returns the minimum of the three bounds, used by the runner timer.
- Day counting is `getResetInfo` (local calendar day after the fix in research D3). The dashboard and the evaluation call the same function.

## Manual instruction (`src/surplus/instruction.js`)

`buildManualInstruction(idea, service)` returns a plain-text block with the idea text, its context and its working folder, plus the command line to start the service's official tool in that folder. Pure, copyable, no side effects (FR-011).
