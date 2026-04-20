# Phase 0 Research - Shared State Backend

## Decision 1: Backend service model

- Decision: Add a dedicated LAN-scoped backend API service in the same deployment stack as the existing frontend.
- Rationale: Shared persistence across devices requires a single authoritative state owner. A backend service centralizes auth, sync rules, conflict resolution, and backups.
- Alternatives considered:
  - Peer-to-peer browser sync: rejected due to complexity, weaker consistency guarantees, and higher conflict surface.
  - Shared file/network drive approach: rejected due to poor concurrency handling and weak access control.

## Decision 2: Database choice

- Decision: Use SQLite in WAL mode as the primary datastore for v1 shared persistence.
- Rationale: For same-network, single-node deployment, SQLite provides ACID transactions, low operational overhead, and easy backup/restore. WAL mode supports concurrent reads with serialized writes, sufficient for expected home/team scale.
- Alternatives considered:
  - PostgreSQL: strong option for larger multi-user scale, but rejected for v1 due to added operational burden for self-hosted local deployments.
  - Keeping browser localStorage only: rejected because it cannot provide shared cross-device state.

## Decision 3: Authentication and authorization

- Decision: Use local account authentication (username/password) with secure session tokens, and workspace-scoped authorization checks on every data endpoint.
- Rationale: Local network access still requires identity and access boundaries. Session-based auth provides revocation and avoids exposing credentials on each request.
- Alternatives considered:
  - No auth on trusted LAN: rejected due to unauthorized access risk on shared networks.
  - External OAuth provider: rejected for v1 because it adds remote dependency contrary to local-network-only requirement.

## Decision 4: Sync and conflict handling

- Decision: Use optimistic concurrency with per-record version numbers and deterministic last-writer-wins only when explicit user override is requested.
- Rationale: Version checks (`expected_version`) detect stale writes deterministically. Returning 409 conflicts with server state allows explicit user choice and traceable outcomes.
- Alternatives considered:
  - Silent last-writer-wins for all updates: rejected because it can hide data loss.
  - Real-time CRDT merge: rejected for v1 due to complexity and higher implementation cost.

## Decision 5: Migration path from localStorage

- Decision: Provide a one-time import endpoint accepting exported local state payloads with idempotency keys and duplicate detection via stable source fingerprints.
- Rationale: Existing users need continuity; migration must be retry-safe and report success/failure per record.
- Alternatives considered:
  - Manual re-entry: rejected due to data loss risk and poor adoption.
  - Automatic silent migration without report: rejected because failures would be opaque.

## Decision 6: Backups and recovery

- Decision: Support scheduled snapshot backups and manual restore with pre-restore safety checks.
- Rationale: Shared state introduces data-loss risk; local operators need predictable recovery.
- Alternatives considered:
  - No backups in v1: rejected due to explicit user requirement.
  - Database-only raw dumps without manifest: rejected because restore reliability and auditability are weaker.

## Decision 7: Local-network-only exposure

- Decision: Restrict service to LAN deployment boundaries, with explicit configuration for bind address, allowed subnet ranges, and operator guidance to avoid public internet exposure.
- Rationale: Requirement states cross-device access on same network only, no remote access.
- Alternatives considered:
  - Expose service publicly by default: rejected as direct violation of requirement.
  - Device-local backend per client: rejected because it does not provide shared persistence.
