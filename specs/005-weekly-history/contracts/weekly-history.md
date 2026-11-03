# Contract: Weekly History State and Review Interface

**Feature**: 005-weekly-history  
**Date**: 2026-04-24  
**Scope**: Frontend weekly-history utilities/hooks and optional shared-record persistence

## Overview

Weekly history exposes a deterministic state interface for recording, retaining, syncing, and reviewing quota snapshots. Current quota state remains writable through existing quota controls; history consumers receive copied snapshot data only.

## Utility Contract

### `getLocalWeekKey(date = new Date())`

```js
/**
 * @param {Date} date
 * @returns {{ weekKey: string, weekStartDate: string, weekEndDate: string }}
 */
getLocalWeekKey(date)
```

**Guarantees**:
- Uses the user's local calendar context.
- Week starts on Monday and ends on Sunday.
- Returns stable date-only strings independent of display locale.
- Handles month and year boundaries deterministically.

### `createWeeklySnapshot({ workspaceId, state, services, now })`

```js
/**
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {QuotaStateMap} input.state
 * @param {ServiceDefinition[]} input.services
 * @param {Date} [input.now]
 * @returns {WeeklyQuotaSnapshot}
 */
createWeeklySnapshot(input)
```

**Guarantees**:
- Deep-copies quota and reset-date values.
- Includes enough service labels and quota metadata to display historical services after rename/removal.
- Does not mutate `state`, `services`, or existing snapshots.
- Produces the same `weekKey` as `getLocalWeekKey(now)`.

### `upsertCurrentWeekSnapshot(history, snapshot)`

```js
/**
 * @param {WeeklyQuotaSnapshot[]} history
 * @param {WeeklyQuotaSnapshot} snapshot
 * @returns {WeeklyQuotaSnapshot[]}
 */
upsertCurrentWeekSnapshot(history, snapshot)
```

**Guarantees**:
- Replaces an existing snapshot with the same `workspaceId` and `weekKey`.
- Does not create duplicate snapshots for the same workspace/week.
- Preserves snapshots from other weeks.
- Returns a new array without mutating the input.

### `retainWeeklySnapshots(history, { now, completedWeeksToKeep = 52 })`

```js
/**
 * @param {WeeklyQuotaSnapshot[]} history
 * @param {object} options
 * @returns {WeeklyQuotaSnapshot[]}
 */
retainWeeklySnapshots(history, options)
```

**Guarantees**:
- Keeps at least the previous 52 completed weeks when they exist.
- Always keeps the current week's snapshot.
- Does not synthesize snapshots for missing weeks.

### `deriveServiceHistorySeries({ history, serviceId, services, fromWeekKey, toWeekKey })`

```js
/**
 * @returns {ServiceHistorySeries}
 */
deriveServiceHistorySeries(input)
```

**Guarantees**:
- Returns ordered weekly entries for the requested range.
- Uses `status='missing_week'` when no snapshot exists.
- Uses `status='missing_service'` when the snapshot exists but the service does not.
- Uses `hasEnoughHistoryForTrends=false` until at least two recorded entries exist.
- Never represents gaps as zero consumption.

## Hook Contract

### Local quota state

`useQuotaState()` continues to return:

```js
{ state, updateQuota, resetAll }
```

Implementation may add history-specific fields if needed:

```js
{
  weeklyHistory,
  refreshWeeklyHistory,
  getServiceHistory
}
```

**Requirements**:
- A current-week snapshot is created when quota state is available.
- Updating a quota or reset date updates the current week's snapshot.
- Recording history must not change live quota values.
- `resetAll()` resets current quotas according to existing behavior and records the resulting current-week snapshot without deleting completed history unless the user explicitly clears history.

### Shared quota state

`useSharedQuotaState()` must keep weekly history scoped to the active `workspaceId`.

**Shared record mapping**:

```js
{
  record_type: 'snapshot',
  logical_key: `weekly-history:${weekKey}`,
  payload: WeeklyQuotaSnapshot
}
```

**Requirements**:
- Same-week updates use the existing record when present and respect optimistic concurrency.
- Conflict handling follows the current shared quota path: pull latest state and retry or surface conflict status.
- Sync pulls must not apply snapshot payloads to current quota state.

## UI Contract

### Weekly history panel

The user-facing review surface must provide:

| State | Required display behavior |
|-------|---------------------------|
| No snapshots | Explain that history starts after the feature is enabled |
| One recorded week | Explain that trends require more weeks of data |
| Multiple recorded weeks | Show service-by-service weekly comparison |
| Missing week | Show an explicit gap message |
| Missing service | Show that the service had no recorded history for that week |
| Removed service | Show historical rows using captured service metadata |

**Non-goals**:
- Do not infer automatic recommendations from weekly history in this feature.
- Do not reconstruct history for weeks that were never recorded.
- Do not transmit weekly history outside the existing workspace sync boundary.

## Backend Contract

The existing shared-state API already accepts `record_type='snapshot'`. Contract coverage for weekly history should verify:

- Creating `snapshot` records with `logical_key='weekly-history:{weekKey}'`.
- Updating the same weekly snapshot without creating duplicates.
- Listing/pulling snapshot records does not mix them into live quota-state records.
- Workspace scoping prevents snapshots from leaking across workspaces.
