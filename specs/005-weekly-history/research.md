# Research: weekly-history

**Phase**: 0 - Outline & Research  
**Date**: 2026-04-24  
**Branch**: `005-weekly-history`

## Decision 1 - Use local calendar-week keys

- **Decision**: Identify snapshots with a deterministic local calendar-week key in ISO-like format: `YYYY-Www`, where the week starts on Monday in the user's local calendar context.
- **Rationale**: The specification assumes the user's local calendar context. A Monday-start week gives stable behavior across month and year boundaries and avoids locale display strings becoming storage identifiers.
- **Alternatives considered**: UTC week keys were rejected because they can roll over on a different day for the user. Locale-formatted labels were rejected because they are display values, not durable keys.

## Decision 2 - Store one snapshot per workspace and week

- **Decision**: Persist one canonical weekly snapshot per active workspace and week using a logical key shaped like `weekly-history:{weekKey}`. Updates within the same week replace the snapshot payload for that key.
- **Rationale**: This directly enforces FR-001 and FR-002 while matching the existing shared-record uniqueness model: `UNIQUE(workspace_id, record_type, logical_key)`.
- **Alternatives considered**: Append-only daily or per-change records were rejected because they create duplicate weekly data and require aggregation before the user can compare weeks.

## Decision 3 - Snapshot payload is a deep copy of service state

- **Decision**: Each weekly snapshot stores copied per-service quota values and reset-date metadata from the current quota state at the time of recording, plus service display metadata needed to explain removed or hidden services later.
- **Rationale**: Historical review must not mutate current quotas and must remain understandable after service lifecycle changes. Copying state keeps history independent from later edits.
- **Alternatives considered**: Storing references to current service objects was rejected because renames/removals would make past rows ambiguous. Storing only derived consumption percentages was rejected because users need inspectable raw weekly values.

## Decision 4 - Retain 52 completed weeks plus the current week

- **Decision**: Retain at least the previous 52 completed weekly snapshots when they exist, and always keep the current week's in-progress snapshot.
- **Rationale**: This satisfies FR-003 while keeping localStorage and sync payloads bounded. The current week is mutable and should not evict completed history.
- **Alternatives considered**: Unlimited retention was rejected for localStorage growth. Exactly 52 total snapshots was rejected because it can drop the current working week or one completed comparison week depending on timing.

## Decision 5 - Missing history is explicit gap data

- **Decision**: History derivation returns explicit gap entries for missing weeks and for services absent from a snapshot; gaps are not converted to zero consumption.
- **Rationale**: FR-006 and the incomplete-history scenarios require users to distinguish missing data from real zero consumption.
- **Alternatives considered**: Filling missing weeks with default quota values was rejected because defaults imply data that was never recorded. Hiding gaps was rejected because it makes trend interpretation misleading.

## Decision 6 - Reuse existing local-first and shared persistence

- **Decision**: Store local snapshots alongside the existing local quota state and sync optional shared snapshots through existing `snapshot` records in the backend.
- **Rationale**: The product already has localStorage state and a LAN-scoped shared-record backend. Reuse avoids new dependencies and preserves privacy-by-default behavior.
- **Alternatives considered**: A new backend table was rejected for v1 because the existing shared-record model already provides workspace scoping, optimistic concurrency, revisions, backup, and sync. External analytics storage was rejected because quota history is private workspace data.

## Decision 7 - Record snapshots opportunistically on quota-state changes and app load

- **Decision**: Ensure the current week's snapshot exists when quota state is available, and update it after quota-state changes using the same debounced persistence pattern as shared quota writes.
- **Rationale**: Users should not need a scheduled background job to get history. Browser apps cannot reliably run when closed, so missed inactive weeks remain visible as gaps rather than synthesized snapshots.
- **Alternatives considered**: A timer-only weekly rollover was rejected because it does not run while the app is closed. Backfilling inactive weeks was rejected because the feature does not reconstruct unrecorded history.
