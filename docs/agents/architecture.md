# Architecture

Kairos has two deliverables: a **static React frontend** that works fully offline, and an **optional LAN-scoped backend** that shares state between devices. The constitution ([`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)) requires the frontend to keep working with no backend at all.

```text
src/                      Frontend (React 18 + Vite 5, CSS Modules)
  data/services.js        Service + task definitions (quota types, costs, reset cycles)
  data/rules.js           Routing rules: pure functions state -> { primary, reason, alts }
  utils.js                Pure helpers: quota math, reset info, weekly-history logic
  stateTransitions.js     Pure state transitions shared by both hooks
  hooks/                  useQuotaState (local) / useSharedQuotaState (local + server sync)
  services/               sharedStateApi.js (HTTP client), localExport.js (migration payload)
  components/             Presentational components, one CSS Module each
backend/                  Optional shared-state API (Node http server, no dependencies)
  src/api/                Router, route modules, validation, idempotency, LAN restriction
  src/services/           Business logic (records, migration, backup, security events)
  src/db/                 sqlite3 CLI client, repositories, migration runner
  src/migrations/         Versioned SQL migrations
  tests/                  contract/ and integration/ suites
docker/, scripts/docker/  Container runtime + helper scripts
specs/                    Spec-driven-development artifacts, one folder per feature
```

## Data flow

1. **Quota state** is `{ [serviceId]: { [quotaId]: number, __last_reset_date: ISO|null } }`, built from `SERVICES` by `buildDefaultState`.
2. `App.jsx` selects a hook: local-only (`useQuotaState`) or shared (`useSharedQuotaState`). Both apply updates through the pure functions in `stateTransitions.js`, so scenarios can be tested in plain Node without a DOM.
3. `RULES[taskId](state, ...)` returns a recommendation. Rules never read the DOM, the clock implicitly, or the network.
4. **Weekly history** (`utils.js`) stores one snapshot per workspace and local calendar week (Monday start), updated in place, 52 completed weeks retained. Snapshots never alter live quota values.

## Persistence

| Where | Key / table | Content |
| --- | --- | --- |
| `localStorage` | `kairos-ai-quota-router:state` | Live quota state (offline source of truth) |
| `localStorage` | `kairos:weekly-history` | Weekly snapshots |
| `localStorage` | `kairos:workspace-id` | Selected shared workspace |
| SQLite | `shared_records` | `record_type` in `quota_state`, `routing_config`, `snapshot`; unique per `(workspace_id, record_type, logical_key)` |
| SQLite | `record_revisions`, `migration_jobs`, `backup_snapshots`, `security_events`, `sessions`, `idempotency_keys` | History, jobs, audit |

Weekly snapshots sync as `snapshot` records with logical key `weekly-history:{weekKey}`; only the current week is pushed.

## Shared-state API

Prefix `/api/v1` (configurable), plus `GET /health`. Updates use optimistic concurrency (`expected_version`, `409` on conflict); migration is retry-safe through an `Idempotency-Key` header. The contract lives in [`specs/002-shared-state-backend/contracts/shared-state-api.openapi.yaml`](../../specs/002-shared-state-backend/contracts/shared-state-api.openapi.yaml).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/workspaces/default` | Resolve default workspace |
| POST | `/auth/login`, `/auth/logout` | Session handling (see [SECURITY.md](../SECURITY.md): data routes do not enforce it) |
| GET/POST | `/workspaces/:id/records` | List / create records |
| PUT/DELETE | `/workspaces/:id/records/:recordId` | Update (versioned) / delete |
| GET | `/workspaces/:id/sync/pull` | Pull changes since a cursor |
| POST/GET | `/workspaces/:id/migrations/local-storage`, `/migrations/:jobId` | Import localStorage, poll job |
| POST/GET | `/workspaces/:id/backups`, `/backups/:backupId/restore` | Backup, list, restore |

## Specs

Every feature has a folder under `specs/NNN-name/` (spec, plan, research, data-model, contracts, quickstart, tasks). Read the relevant spec before changing a feature; update it when behavior changes.
