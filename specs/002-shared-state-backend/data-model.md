# Data Model - Shared State Backend

## Overview

The shared backend uses a single authoritative workspace datastore. All client devices sync through backend APIs; direct client-to-client state exchange is out of scope.

## Entities

### User

- Purpose: Authenticated identity for shared-state access.
- Fields:
  - `id` (UUID, immutable)
  - `username` (string, unique, 3-64 chars)
  - `password_hash` (string, non-null)
  - `role` (enum: `owner`, `member`)
  - `is_active` (boolean)
  - `created_at` (timestamp)
  - `last_login_at` (timestamp, nullable)
- Validation:
  - Username unique per deployment.
  - Password must meet minimum strength policy.

### Workspace

- Purpose: Shared boundary for records and policies in one local deployment.
- Fields:
  - `id` (UUID, immutable)
  - `name` (string)
  - `created_by_user_id` (UUID, FK -> User)
  - `created_at` (timestamp)
  - `updated_at` (timestamp)
- Validation:
  - Name required and non-empty.

### WorkspaceMember

- Purpose: User membership and permissions in a workspace.
- Fields:
  - `workspace_id` (UUID, FK -> Workspace)
  - `user_id` (UUID, FK -> User)
  - `permission` (enum: `read`, `write`, `admin`)
  - `joined_at` (timestamp)
- Constraints:
  - Composite unique key (`workspace_id`, `user_id`).

### SharedRecord

- Purpose: Canonical synchronized domain state item.
- Fields:
  - `id` (UUID, immutable)
  - `workspace_id` (UUID, FK -> Workspace)
  - `record_type` (enum: `quota_state`, `routing_config`, `snapshot`)
  - `logical_key` (string, unique within workspace and record_type)
  - `payload` (JSON object)
  - `version` (integer, starts at 1)
  - `updated_by_user_id` (UUID, FK -> User)
  - `updated_at` (timestamp)
  - `deleted_at` (timestamp, nullable for soft delete)
- Validation:
  - `payload` must satisfy schema rules for `record_type`.
  - `version` increments by exactly 1 on successful update.

### RecordRevision

- Purpose: Audit trail and conflict diagnostics for updates.
- Fields:
  - `id` (UUID)
  - `record_id` (UUID, FK -> SharedRecord)
  - `workspace_id` (UUID, FK -> Workspace)
  - `previous_version` (integer)
  - `new_version` (integer)
  - `change_source` (enum: `api_write`, `migration`, `restore`)
  - `change_summary` (string)
  - `created_by_user_id` (UUID, FK -> User)
  - `created_at` (timestamp)

### MigrationJob

- Purpose: Track import of browser-local data into shared persistence.
- Fields:
  - `id` (UUID)
  - `workspace_id` (UUID, FK -> Workspace)
  - `requested_by_user_id` (UUID, FK -> User)
  - `source_device_id` (string)
  - `idempotency_key` (string, unique)
  - `status` (enum: `pending`, `running`, `completed`, `failed`, `partial`)
  - `started_at` (timestamp)
  - `completed_at` (timestamp, nullable)
  - `total_records` (integer)
  - `migrated_records` (integer)
  - `skipped_records` (integer)
  - `failed_records` (integer)
  - `error_report` (JSON array, nullable)

### BackupSnapshot

- Purpose: Point-in-time recoverable backup metadata.
- Fields:
  - `id` (UUID)
  - `workspace_id` (UUID, FK -> Workspace)
  - `status` (enum: `created`, `failed`, `restored`)
  - `storage_path` (string)
  - `checksum` (string)
  - `created_by_user_id` (UUID, FK -> User)
  - `created_at` (timestamp)
  - `restored_at` (timestamp, nullable)

### SecurityEvent

- Purpose: Security and privacy auditability.
- Fields:
  - `id` (UUID)
  - `event_type` (enum: `login_success`, `login_failure`, `access_denied`, `token_revoked`, `config_change`)
  - `user_id` (UUID, nullable)
  - `workspace_id` (UUID, nullable)
  - `source_ip` (string)
  - `metadata` (JSON object)
  - `occurred_at` (timestamp)

## Relationships

- User M:N Workspace through WorkspaceMember.
- Workspace 1:N SharedRecord.
- SharedRecord 1:N RecordRevision.
- Workspace 1:N MigrationJob.
- Workspace 1:N BackupSnapshot.
- User 1:N SecurityEvent (optional link).

## State Transitions

### SharedRecord lifecycle

- `active(v1+)` -> `active(v+1)` on successful version-checked update.
- `active` -> `soft_deleted` when delete requested and authorized.
- `soft_deleted` -> `active` only through explicit restore workflow.

### MigrationJob lifecycle

- `pending` -> `running` -> `completed`
- `running` -> `partial` when some records fail
- `running` -> `failed` on unrecoverable import error

### BackupSnapshot lifecycle

- `created` on successful snapshot generation
- `failed` if backup generation fails
- `restored` when snapshot is used for recovery

## Concurrency and Consistency Rules

- Writes require `expected_version`; mismatches return conflict.
- Conflict response includes current server version and payload preview.
- All writes execute in transactions.
- Backup and restore operations use maintenance lock windows to prevent partial writes.
