# Quickstart: weekly-history

**Feature**: 005-weekly-history  
**Branch**: `005-weekly-history`

## Goal

Verify that Kairos records one quota-state snapshot per local calendar week, updates the current week in place, and lets users review service history without confusing missing data for zero usage.

## Setup

1. Start the app with the normal development command:

   ```bash
   npm run dev
   ```

2. Use a browser profile with an empty Kairos localStorage state, or clear only Kairos keys before testing.
3. If validating shared sync, start the backend separately and confirm the app is connected to a workspace.

## Manual Verification

### 1. Current-week snapshot creation

1. Open the app with default quota state.
2. Confirm weekly history contains one snapshot for the current local week.
3. Confirm the snapshot includes all currently visible services and quota fields.

Expected result: one `weekly-history:{weekKey}` snapshot exists for the active workspace.

### 2. Same-week update

1. Change Claude weekly quota.
2. Change ChatGPT Codex remaining quota.
3. Reopen weekly history.

Expected result: the same week still has exactly one snapshot, and that snapshot reflects the latest values.

### 3. New-week rollover

1. Run utility tests or use a controlled clock/date injection to simulate the next local week.
2. Change one quota value after the week boundary.

Expected result: a new weekly snapshot is created for the new `weekKey`; the previous week's snapshot remains available.

### 4. Missing history

1. Review a range that includes a week before the feature recorded any snapshot.
2. Review a service that was absent from an older snapshot fixture.

Expected result: missing weeks and missing service rows are shown as gaps, not as zero consumption.

### 5. Service lifecycle

1. Use a fixture containing historical data for a service that is not in the current service catalog.
2. Open weekly history.

Expected result: the historical service remains understandable using captured service metadata.

### 6. Current quota safety

1. Record several weekly snapshots.
2. Open and navigate weekly history.
3. Return to the main quota cards.

Expected result: reviewing history does not change current quota values.

## Automated Verification Targets

Run frontend utility tests:

```bash
node --test src/utils.weekly-history.test.js
```

Run the existing backend test suite if shared snapshot persistence is modified:

```bash
npm run test:backend
```

## Acceptance Checklist

- [ ] No duplicate snapshot exists for the same workspace and week.
- [ ] Current-week snapshot updates in place after quota changes.
- [ ] At least 52 completed weeks can be retained when fixtures provide that history.
- [ ] Missing weeks are visibly distinct from zero consumption.
- [ ] Service-specific history can be reviewed across multiple weeks.
- [ ] Historical data for removed or hidden services remains displayable.
- [ ] Weekly history remains scoped to the active workspace.
- [ ] History review never mutates current quota state.
