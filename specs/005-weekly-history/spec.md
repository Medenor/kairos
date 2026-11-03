# Feature Specification: weekly-history

**Feature Branch**: `[005-weekly-history]`  
**Created**: 2026-04-24  
**Status**: Draft  
**Input**: User description: "Weekly history — save a quota state snapshot per week to identify consumption patterns over time"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Weekly Quota State (Priority: P1)

As a user, I want the app to preserve one quota state snapshot each week so I can look back at how my available quota changed over time.

**Why this priority**: Historical weekly data is the foundation for every pattern and trend insight requested by the feature.

**Independent Test**: Advance through multiple weeks with different quota states and confirm each week has a distinct saved snapshot that can be reviewed later.

**Acceptance Scenarios**:

1. **Given** the user has current quota state for one or more services, **When** a new week is reached, **Then** the system preserves a weekly snapshot for that week.
2. **Given** a snapshot already exists for the current week, **When** quota state changes later in the same week, **Then** the current week's snapshot reflects the latest weekly state without creating duplicate entries for the same week.

---

### User Story 2 - Review Consumption Patterns (Priority: P2)

As a user, I want to review weekly quota history by service so I can identify recurring consumption patterns and adjust my usage habits.

**Why this priority**: The saved history must be visible and understandable for users to extract value from it.

**Independent Test**: Create several weekly snapshots with varying service usage and verify the user can compare weeks for each service.

**Acceptance Scenarios**:

1. **Given** at least two weekly snapshots exist, **When** the user reviews a service's history, **Then** they can see how that service's quota changed from week to week.
2. **Given** multiple services have historical snapshots, **When** the user reviews weekly history, **Then** they can distinguish each service's pattern without confusing one service's usage with another.

---

### User Story 3 - Handle Incomplete History (Priority: P3)

As a user, I want clear handling of weeks with missing or limited history so I do not mistake incomplete data for actual consumption patterns.

**Why this priority**: History may start after the app has already been used, and gaps should not mislead users.

**Independent Test**: Review history when only one snapshot exists, when a service appears after prior snapshots, and when a week has no recorded activity.

**Acceptance Scenarios**:

1. **Given** only one weekly snapshot exists, **When** the user opens weekly history, **Then** the system explains that trends require additional weeks of data.
2. **Given** a service was added after earlier snapshots were saved, **When** the user reviews history, **Then** earlier weeks clearly show that the service had no recorded history for those weeks.
3. **Given** a week has no saved snapshot, **When** the user reviews a date range that includes that week, **Then** the gap is visible and not presented as zero consumption.

### Edge Cases

- The user opens the app after one or more weeks without activity.
- A service is renamed, added, hidden, or removed after historical snapshots already exist.
- Quota state is reset during the same week a snapshot is saved.
- The current week crosses a calendar boundary such as a new month or new year.
- Historical data exists for a service that no longer appears in the current quota view.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST preserve one quota state snapshot for each calendar week in which quota state is available.
- **FR-002**: The system MUST update the current week's snapshot when quota state changes during that same week, rather than creating multiple snapshots for one week.
- **FR-003**: The system MUST retain enough weekly snapshots for users to compare at least the previous 52 completed weeks when that history exists.
- **FR-004**: Users MUST be able to review saved weekly snapshots by service.
- **FR-005**: Users MUST be able to compare a service's quota state across multiple weeks.
- **FR-006**: The system MUST clearly distinguish missing weekly history from zero consumption.
- **FR-007**: The system MUST preserve historical snapshots for services that are later removed or hidden, so past consumption remains understandable.
- **FR-008**: The system MUST show when weekly history is too short to support meaningful pattern analysis.
- **FR-009**: The system MUST keep weekly history scoped to the same user workspace as the quota state it describes.
- **FR-010**: The system MUST avoid changing current quota values when recording or displaying historical snapshots.

### Key Entities *(include if feature involves data)*

- **Weekly Quota Snapshot**: A saved record of quota state for a specific calendar week, including the services and quota values known for that week.
- **Service History Series**: The ordered weekly snapshots for one service, used to review changes over time.
- **History Gap**: A week in the reviewed range where no snapshot exists or where a service had no recorded state.
- **Consumption Pattern**: A user-visible trend inferred from week-to-week changes in quota state.

## Constitution Alignment *(mandatory)*

- **User Value**: Improves quota visibility and decision speed by showing how usage evolves over time instead of only showing the current state.
- **Determinism**: Weekly history is based on explicit calendar-week snapshots, with one canonical snapshot per week and visible handling for gaps.
- **Verification Plan**: Validate snapshot creation, same-week updates, multi-week review, missing-history states, and service lifecycle cases with scenario-based checks.
- **Explainability**: Users can inspect the weekly values behind any observed pattern and can see when data is incomplete.
- **Dependency & Privacy Impact**: Uses existing quota state as historical user data and keeps it within the same workspace privacy boundary; no new external data source is required.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After four weeks of recorded use, users can identify the highest-consumption service in under 30 seconds in at least 90% of review sessions.
- **SC-002**: In 100% of weekly snapshot checks, no more than one snapshot exists for the same workspace and calendar week.
- **SC-003**: In 100% of history reviews, missing weeks or missing service data are visibly distinct from weeks with zero consumption.
- **SC-004**: Users can compare at least two weeks of quota history for a service in under 20 seconds when two or more snapshots exist.
- **SC-005**: Historical review never changes current quota values in 100% of regression checks.

## Assumptions

- A calendar week is interpreted in the user's local calendar context.
- The current week's snapshot represents the latest known quota state for that week.
- Historical review starts from the point this feature is enabled; it does not reconstruct weeks that were never recorded.
- A 52-week lookback is sufficient for the initial feature to reveal recurring weekly and seasonal usage patterns.
- Weekly history is for user review and pattern recognition, not for automatic quota correction.
