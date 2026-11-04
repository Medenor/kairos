# Contract: generic routing rules

Module `src/routing/engine.js`. Pure: no DOM, no clock, no network, no mutation of inputs. `ROUTING_RULESET_VERSION = 2` (the fixed-provider rules were version 1 and live only in test fixtures).

## Signature

```
recommend({ task, providers, state, now }) -> Recommendation
```

- `task`: a task id from the fixed list (`src/data/tasks.js`).
- `providers`: runtime services from `toRuntimeService` (active providers only), each with `quotas[].gates` and the provider's `fits`.
- `state`: quota state keyed by provider and quota id. `now`: a `Date`, the same value the dashboard and the surplus evaluation receive.

```
Recommendation = {
  rulesetVersion, taskId,
  primary: ProviderResult | null,
  alternatives: ProviderResult[],          // at most 3, in rank order
  excluded: { providerId, name, cause: 'not_suitable'|'blocked'|'unread', detail }[],
  reason: string,
  tieBreak: null | { criterion, between: [providerId, providerId] }
}
ProviderResult = { providerId, name, fit, score, pressure, gatingQuotaId, daysToReset, resetState }
```

## Rules (in order)

1. **Candidates**: all providers. Each is classified: fit `none`/undeclared → `not_suitable`; any gating quota with no reading → `unread`; any gating quota fully consumed → `blocked`; otherwise eligible.
2. **Pressure**: highest consumed percentage among the quotas gating the task, via `getConsumedPct` (currency: bands of `lowBalance`, research D6).
3. **Score**: `fit(3,2,1) − penalty`, penalty 0 below 60 %, 1 from 60 % to below 85 %, 2 from 85 % to below 100 %.
4. **Order** (total, independent of input order): score desc; pressure bucket `floor(p/15)` asc; days to reset asc among `countdown`/`due`, others last; pressure asc; fit desc; normalised name; provider id.
5. **Primary** is the first eligible; **alternatives** the next up to 3; **tieBreak** names the first criterion that differs between primary and runner-up (`score`, `pressure_bucket`, `reset`, `pressure`, `fit`, `name`).
6. **Reason** states: primary name, its fit and gating pressure, days to reset, the decisive criterion against the runner-up, and the reset note (due today / overdue / resets in ≤ 2 days: spend it now). Excluded providers are summarised with their causes.
7. **No primary**: reason says which of "no provider declared", "no provider suited to this task", "all suited providers blocked or unread" applies, and for blocked providers with a known reset gives the soonest reset date.

## Determinism and independence (FR-014, SC-004)

- `recommend` with the same inputs returns deep-equal results.
- Permuting `providers` (creation or display order) never changes the result.
- No provider name or id literal appears in the module (guard test, research D18).

## Shared tie-break

`src/providers/tiebreak.js` exports `compareByName(a, b)` (NFC, trim, case fold, then id) used as the tail of rule 4 and by `evaluateSurplus`, whose ranking becomes: `daysToReset` asc, then `compareByName`. The surplus explanation names the tie-break when two eligible providers share the same days to reset.

## Before/after scenarios (Constitution: routing changes)

`src/routing/fixtures/legacyProviders.js` declares the former five providers as user would (fits, gates, thresholds as declared inputs) and `legacyRules.js` is a verbatim copy of the removed `rules.js`. `routing.reference.test.js` runs a grid of states (claude weekly × slot, copilot monthly, chatgpt remaining, balances, reset days) for each of the five tasks, asserts the same primary provider where the rules agree, and lists every divergence in an `INTENDED_DIFFERENCES` table with the reason (D7, D8). A divergence not in the table fails the test.
