# Data Model: weekly-history

**Phase**: 1 - Design & Contracts  
**Date**: 2026-04-24  
**Branch**: `005-weekly-history`

## Overview

Weekly history adds persisted snapshot records and derived review series. Current quota state remains the source of truth for live recommendations; weekly history is a copied, read-only record used for review.

## Entities

### WeeklyQuotaSnapshot

A persisted snapshot for one workspace and one local calendar week.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Local/generated id or backend shared-record id |
| `workspaceId` | `string` | Active workspace identifier |
| `weekKey` | `string` | Local calendar-week key, e.g. `2026-W17` |
| `weekStartDate` | `string` | Local date-only string for the Monday starting the week |
| `weekEndDate` | `string` | Local date-only string for the Sunday ending the week |
| `capturedAt` | `string` | ISO timestamp for the latest update to this week's snapshot |
| `services` | `Record<string, SnapshotServiceState>` | Copied service state keyed by service id |
| `schemaVersion` | `number` | Snapshot payload version, initially `1` |

**Validation rules**:
- `workspaceId` and `weekKey` are required.
- `(workspaceId, weekKey)` must be unique in local and shared storage.
- `capturedAt` must update when the current week's snapshot is replaced.
- `services` must be a deep copy of current quota state; later live-state edits must not mutate older snapshot objects.

### SnapshotServiceState

The state copied for one service inside a weekly snapshot.

| Field | Type | Description |
|-------|------|-------------|
| `serviceId` | `string` | Stable service id |
| `serviceName` | `string` | Display name at capture time |
| `quotas` | `Record<string, SnapshotQuotaValue>` | Copied quota values keyed by quota id |
| `lastResetDate` | `string \| null` | Copied `__last_reset_date` value, if present |
| `capturedServiceMeta` | `object` | Minimal label/reset metadata needed to display removed or renamed services |

**Validation rules**:
- Services removed from the current catalog must remain displayable from snapshot metadata.
- Missing service data in an older snapshot is represented by a history gap, not by an empty zero-value service.

### SnapshotQuotaValue

A copied quota field from the service state.

| Field | Type | Description |
|-------|------|-------------|
| `quotaId` | `string` | Stable quota id |
| `label` | `string` | Quota label at capture time |
| `type` | `'consumed_pct' \| 'remaining_pct' \| 'currency'` | Quota interpretation |
| `value` | `number` | Captured quota value |
| `currency` | `string \| null` | Currency code/symbol for currency quotas |
| `consumedPct` | `number \| null` | Derived normalized consumption percentage where applicable |

**Validation rules**:
- Percentage values must stay in the supported 0-100 range.
- Currency values must be numeric and must not be converted into zero-consumption history.
- `consumedPct` is derived for comparison and does not replace raw `value`.

### ServiceHistorySeries

A derived, ordered review model for one service across a requested week range.

| Field | Type | Description |
|-------|------|-------------|
| `serviceId` | `string` | Service id being reviewed |
| `displayName` | `string` | Current service name or captured historical name |
| `entries` | `ServiceHistoryEntry[]` | Ordered weekly entries and gaps |
| `hasEnoughHistoryForTrends` | `boolean` | True when at least two recorded entries exist |
| `recordedWeekCount` | `number` | Count of entries with actual service data |

### ServiceHistoryEntry

A derived row for one week in a service history review.

| Field | Type | Description |
|-------|------|-------------|
| `weekKey` | `string` | Week represented by this row |
| `weekStartDate` | `string` | Week start date |
| `status` | `'recorded' \| 'missing_week' \| 'missing_service'` | Distinguishes actual data from gaps |
| `quotas` | `SnapshotQuotaValue[]` | Captured quotas when `status='recorded'` |
| `message` | `string` | User-facing explanation for gaps or short history |

**Validation rules**:
- `missing_week` means no snapshot exists for that week.
- `missing_service` means a snapshot exists but the service was not present in it.
- Neither gap status may be displayed as zero consumption.

## State Transitions

### WeeklyQuotaSnapshot

```text
No snapshot for current week
  -> create snapshot when quota state is available

Snapshot exists for current week
  -> replace payload when quota state changes in the same week

Week boundary reached while app is used
  -> create a new snapshot for the new week

One or more weeks passed while app was closed
  -> create current-week snapshot on next app load; skipped weeks remain gaps
```

### ServiceHistorySeries

```text
0 recorded entries -> empty history message
1 recorded entry   -> insufficient trend message
2+ recorded entries -> comparison and pattern review enabled
```

## Persistence Mapping

### Local

Weekly snapshots are stored under a dedicated localStorage key, separate from `kairos-ai-quota-router:state`, to avoid accidental mutation of current quota state.

### Shared Backend

Shared snapshots use existing shared records:

| Shared record field | Value |
|---------------------|-------|
| `record_type` | `snapshot` |
| `logical_key` | `weekly-history:{weekKey}` |
| `payload` | Serialized `WeeklyQuotaSnapshot` |
| `workspace_id` | Active workspace id |

No backend schema migration is required unless implementation discovers missing contract coverage.
