# Feature Specification: Shared State Backend

**Feature Branch**: `[002-shared-state-backend]`  
**Created**: 2026-04-14  
**Status**: Draft  
**Input**: User description: "Current containerized app remains browser-local (localStorage). Shared data requires new architecture (at least a backend API + database, auth, sync rules, conflict handling, backups). I need to be able to access the app from another device on the same network (no remote access). I need shared state backend for shared persistence. Define: Data model and DB choice, API contract, Migration path from localStorage, Privacy/security requirements"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared Data Across Devices (Priority: P1)

As a user on a home/office network, I can open the app from two different devices and see the same up-to-date data so I can continue work seamlessly.

**Why this priority**: Shared persistence across devices is the primary value and the direct reason for this feature.

**Independent Test**: Can be fully tested by creating or editing records on Device A and confirming Device B reflects the same records after sync.

**Acceptance Scenarios**:

1. **Given** two authenticated devices connected to the same local network workspace, **When** a user creates or updates shared data on Device A, **Then** Device B can retrieve and display that updated data.
2. **Given** existing shared data, **When** the user opens the app on a new device in the same network workspace, **Then** the app loads the shared state instead of an empty local-only state.

---

### User Story 2 - Safe Migration from Browser-Only Data (Priority: P2)

As an existing user, I can migrate my current browser-local data into shared persistence without losing records so I can keep historical work.

**Why this priority**: Existing data continuity is required for adoption; users will not switch if prior data is lost.

**Independent Test**: Can be tested by seeding browser-local data, running migration once, and verifying all expected records exist in shared persistence with no unintended duplication.

**Acceptance Scenarios**:

1. **Given** a device with existing browser-local data, **When** the user initiates migration to shared persistence, **Then** all eligible records are imported and mapped to the shared data model.
2. **Given** a completed migration, **When** the migration step is retried, **Then** already migrated records are not duplicated.

---

### User Story 3 - Controlled Local-Network Access and Recovery (Priority: P3)

As an operator of the shared instance, I can restrict access to authorized users on the same network and recover data from backups so shared data remains private and resilient.

**Why this priority**: Privacy and recoverability are essential for shared state but secondary to core data sharing and migration.

**Independent Test**: Can be tested by denying unauthorized access attempts, verifying authorized access succeeds, and restoring from a recent backup snapshot.

**Acceptance Scenarios**:

1. **Given** a user without valid credentials, **When** that user attempts to access shared data, **Then** access is denied and no shared records are exposed.
2. **Given** periodic backups exist, **When** a recovery is triggered after simulated data loss, **Then** shared data is restorable to the last successful backup point.

### Edge Cases

- Two devices edit the same record before either receives the other update.
- A device goes offline during synchronization and reconnects later.
- Migration input contains malformed or partially missing fields from browser-local storage.
- Migration is interrupted and resumed later.
- Backup execution overlaps with active writes.
- A device outside the trusted local network attempts access.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide shared persistence as the authoritative source of state for all supported devices on the same local network deployment.
- **FR-002**: The system MUST define and persist a canonical data model for shared entities, including stable record identifiers, ownership metadata, timestamps, and change version metadata.
- **FR-003**: The system MUST use a transactional, queryable shared datastore optimized for multi-user consistency and recovery.
- **FR-004**: The system MUST define an API contract for shared state operations, including create, read, update, delete, list, and synchronization-related operations, with explicit request/response validation rules.
- **FR-005**: The system MUST authenticate users before allowing access to shared state operations.
- **FR-006**: The system MUST enforce authorization rules so users can only access data they are permitted to view or modify.
- **FR-007**: The system MUST define synchronization rules for multi-device updates, including deterministic conflict handling and user-visible conflict outcomes.
- **FR-008**: The system MUST provide a migration path from browser-local storage to shared persistence, including field mapping, validation, and idempotent import behavior.
- **FR-009**: The system MUST preserve data integrity during migration by reporting migrated, skipped, and failed records.
- **FR-010**: The system MUST support secure backup creation and recovery procedures for shared data.
- **FR-011**: The system MUST limit shared-state service exposure to local-network access unless explicitly reconfigured by an administrator.
- **FR-012**: The system MUST protect sensitive data in transit and at rest according to defined privacy and security rules.
- **FR-013**: The system MUST produce auditable security and data-change events sufficient to investigate unauthorized access and data-loss incidents.
- **FR-014**: The system MUST provide clear user-facing states for synchronization status, migration status, and recoverable failure conditions.

### Key Entities *(include if feature involves data)*

- **User Account**: Identity used for authentication and permission checks for shared data access.
- **Workspace**: Shared logical container for records visible to one local deployment context.
- **Shared Record**: Canonical persisted business object synchronized across devices, with immutable ID and version metadata.
- **Record Revision**: Versioned change event linked to a shared record, used for conflict detection and ordering.
- **Migration Job**: One-time or repeatable import run that maps browser-local records into shared persistence with per-record outcomes.
- **Backup Snapshot**: Point-in-time recoverable copy of shared data and required metadata.
- **Access Policy**: Rules that define which users can read or modify specific records or workspaces.

## Constitution Alignment *(mandatory)*

- **User Value**: Users gain faster decision continuity because their routing and quota context follows them across devices on the same network.
- **Determinism**: Shared-state synchronization and conflict outcomes follow explicit, documented rules so results are reproducible.
- **Verification Plan**: Validate cross-device consistency, migration idempotency, conflict outcomes, authorization boundaries, and backup recovery through scenario-based tests.
- **Explainability**: Users and reviewers can inspect sync status, migration outcomes, and conflict resolution results via explicit system states and logs.
- **Dependency & Privacy Impact**: Introduces a new backend persistence dependency; privacy controls require authenticated local-network access, least-privilege authorization, and explicit handling of sensitive usage data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, users can create or update shared records on one device and observe the same state on a second device within 5 seconds for at least 95% of operations on a local network.
- **SC-002**: At least 99% of valid browser-local records are migrated successfully on first run, with a complete outcome report for remaining records.
- **SC-003**: Re-running migration after a completed import produces no duplicate shared records in 100% of test runs.
- **SC-004**: 100% of unauthorized access attempts to shared records are blocked in security acceptance tests.
- **SC-005**: Backup-and-restore drills recover shared records to the last successful backup point in at least 95% of scheduled recovery tests.

## Assumptions

- Shared-state access is required only within a trusted local network; internet-facing access is out of scope for this feature.
- Existing users can authenticate with credentials managed by the same deployment context.
- Browser-local data currently uses stable enough field shapes to support deterministic mapping to the canonical shared model.
- Organization-level multi-site replication is out of scope for this phase.
- Legal/regulatory requirements beyond baseline local privacy controls are not in scope unless later specified.
