# Quickstart - Shared State Backend

## Goal

Validate the shared-state backend flow end-to-end on a local network:
- migrate existing browser-local state
- sync records across two devices
- run backup and restore drill

## Prerequisites

- One backend host reachable from both test devices on the same LAN.
- Two browser clients (Device A and Device B).
- Existing localStorage state on Device A for migration test.
- Operator account credentials.

## 1. Start the stack

1. Start backend and frontend services:
   - `npm install`
   - `npm run backend:migrate`
   - `npm run backend:start`
   - In another terminal: `npm run dev`
2. Alternative shared container stack: `scripts/docker/run-shared.sh`
3. Confirm frontend is reachable from both devices.
4. Confirm API health endpoint is reachable from LAN clients (`GET /health`).

## 2. Access model

1. Access the app and API from devices on the same trusted LAN.
2. Verify LAN-only restriction behavior for non-allowed source ranges.

## 3. Migrate localStorage data

1. On Device A, trigger local data import.
2. Verify migration job reaches `completed` or `partial` with explicit record counts.
3. Re-run the same migration payload with the same idempotency key and confirm no duplicate records are created.

## 4. Cross-device sync

1. On Device A, update one quota value and one routing preference.
2. On Device B, trigger sync pull.
3. Confirm Device B reflects the updated state within the expected SLA window.
4. Create a concurrent edit conflict intentionally and confirm conflict response is explicit and resolvable.

## 5. Backup and restore

1. Trigger a backup snapshot.
2. Introduce a controlled destructive change in test data.
3. Restore from the latest snapshot.
4. Verify records are recovered to snapshot point.

## 6. Security and privacy checks

1. Attempt access from outside allowed LAN ranges and verify denial.
2. Verify service exposure remains LAN-scoped.
3. Verify security events are logged for denied requests.

## Expected Outcomes

- Shared state remains consistent across devices.
- Migration is retry-safe.
- Conflict handling is deterministic.
- Access outside allowed LAN ranges is blocked.
- Backup/restore path is operational.
