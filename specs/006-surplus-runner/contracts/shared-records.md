# Contract: shared records for surplus-runner

No backend route or schema changes. Everything uses the existing endpoints of [feature 002](../../002-shared-state-backend/contracts/shared-state-api.openapi.yaml): `GET/POST /workspaces/:id/records`, `PUT/DELETE /workspaces/:id/records/:recordId`, `GET /workspaces/:id/sync/pull`.

All records use `record_type: "routing_config"`. The logical key namespace identifies the kind. Payload shapes are in [data-model.md](../data-model.md).

| Logical key | Writer | Update rule | Notes |
| --- | --- | --- | --- |
| `surplus-policy` | Browser | `PUT` with `expected_version`; last writer wins after a 409 refresh | Includes disclosure acknowledgement |
| `surplus-control` | Browser (global stop), runner (on fatal error) | Any client may set `autoRunEnabled=false` | Restricting-only for the runner |
| `idea:{id}` | Browser, runner (status only) | `PUT` with `expected_version`; runner changes only `status`, `serviceId`, `lastRunId`, `updatedAt` | Claim `waiting -> running` is a compare-and-set; 409 means do not run |
| `run:{id}` | Runner | `POST` on claim (status `running`), one `PUT` on finalisation, never again | Browser treats finalised runs as read-only |
| `cycle:{serviceId}:{resetDate}` | Browser, runner | `PUT` upsert | Only the last reading and its time |
| `runner-lease` | Runner | `PUT` heartbeat every 60 s with `expected_version` | Expired after 180 s without heartbeat; also carries `designatedDeviceId`, which survives expiry |

## Trust rules (FR-013)

- The runner never reads `approvalRequested`, `approved` (lease) or `autoRunEnabled` as an authorisation to run an idea. They are display inputs or restrictions.
- The runner re-fetches the idea immediately before claiming and recomputes the local content hash from that fetch.
- Payloads are validated on read in `src/surplus/ideas.js` (types, enums, length limits). A record that fails validation is ignored and listed as "invalid record" in the dashboard, never run.

## Client behaviour

- Local-first: the browser writes `localStorage` first and syncs in the background (same pattern as `useSharedQuotaState`, debounce 220 ms).
- Pull: the browser and the runner use `sync/pull` with the stored cursor; records outside the `routing_config` namespace list above are ignored by the new apply function, and the existing `applyServerRecords` ignores `routing_config` entirely, so quota state and weekly snapshots are unaffected.
- A 409 triggers a refresh and a re-evaluation of the pending change; the idea record is merged field by field (runner-owned fields vs user-owned fields) before retrying once.

## Backend test (additive)

`backend/tests/contract/surplus-records.contract.test.js`: create, update with version, 409 on stale version, list with `since`, soft-delete, for keys of each namespace, asserting that quota state and snapshot records in the same workspace are untouched.
