# Architecture

Kairos has three deliverables: a **static React frontend** that works fully offline, an **optional LAN-scoped backend** that shares state between devices, and an **optional local runner** (`runner/`) that executes approved ideas on one machine. The constitution ([`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)) requires the frontend to keep working with no backend at all.

```text
src/                      Frontend (React 18 + Vite 5, CSS Modules)
  data/tasks.js           The five fixed task types a recommendation is computed for
  providers/              User-declared providers (feature 007): ids, schema, catalogue reducers, runtime mapping, records, engine
  routing/                Generic deterministic recommendation engine (replaces the former per-provider rule table)
  sync/                   Generic local-first record-sync core (dirty set, debounced flush, 409 resolution) used by surplus/ and providers/
  utils.js                Pure helpers: quota math, reset info (local calendar day), weekly-history logic
  stateTransitions.js     Pure state transitions shared by both hooks
  surplus/                Pure surplus-runner logic shared with runner/ (see "Surplus runner" below)
  hooks/                  useQuotaState (local) / useSharedQuotaState (local + server sync) / useSurplusStore
  services/               sharedStateApi.js (HTTP client), localExport.js (migration payload)
  components/             Presentational components, one CSS Module each
runner/                   Optional local CLI (Node built-ins only), imports ../src/surplus/*.js
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

1. **Providers** are declared by the user (nothing is shipped or pre-filled). The catalogue lives in `localStorage` (`kairos:providers`) and, in shared mode, as `routing_config` records. **Quota state** is `{ [providerId]: { [quotaId]: number|null, __last_reset_date: ISO|null, __ts_{quotaId}: ISO|null } }`; `buildDefaultState(providers)` is `{}` without providers and leaves a provider's quotas unread (`null`). Entries of ids no provider defines (data of the previous fixed-provider build) are never read and never rewritten.
2. `App.jsx` selects a hook: local-only (`useQuotaState`) or shared (`useSharedQuotaState`). Both apply updates through the pure functions in `stateTransitions.js`, so scenarios can be tested in plain Node without a DOM.
3. `recommend({ task, providers, state, now })` (`src/routing/engine.js`) returns a recommendation with a reason, alternatives and the providers left out with their cause. It never reads the DOM, the clock implicitly, or the network, and names no provider; the order is total and independent of creation or display order (score = declared fit minus a pressure-band penalty, then pressure bucket, sooner reset, pressure, fit, normalised name, id). Rules and reference differences: [`specs/007-dynamic-providers/contracts/routing-rules.md`](../../specs/007-dynamic-providers/contracts/routing-rules.md).
4. **Weekly history** (`utils.js`) stores one snapshot per workspace and local calendar week (Monday start), 52 completed weeks retained. Schema v2 keys entries by provider id (`providers` map with the name and meta captured at the time); entries of removed providers are kept and marked `removedAt`; the `services` section of a v1 snapshot is carried verbatim and shown as the previous version; two snapshots of the same week are merged by union (`mergeWeekSnapshots`), never replaced. Snapshots never alter live quota values or the catalogue.
5. **Quota reading stamps.** `applyQuotaUpdate` stamps `__ts_{quotaId}` with an injected `now`; `confirmQuotas` stamps every quota of a service without changing values (the "still current" action on `ServiceCard`). The keys sit next to `__last_reset_date`, so they persist and sync as ordinary `quota_state` records (logical key `{providerId}:{key}`). `null` means never confirmed, which the surplus evaluation treats as not fresh. Pressure, snapshots and rules iterate `svc.quotas` and ignore these keys.
6. **Day basis.** `getResetInfo` counts days on the user's **local calendar day** (the dashboard and the surplus evaluation call the same function, so they agree near midnight). Weekly history already used local weeks. Tests that depend on the day set `TZ` explicitly.

## Persistence

| Where | Key / table | Content |
| --- | --- | --- |
| `localStorage` | `kairos:providers` (+ `kairos:providers:dirty`) | Provider catalogue: definitions, tombstones, display order |
| `localStorage` | `kairos-ai-quota-router:state` | Live quota state (offline source of truth) |
| `localStorage` | `kairos:weekly-history` | Weekly snapshots |
| `localStorage` | `kairos:workspace-id` | Selected shared workspace |
| `localStorage` | `kairos:surplus:{ideas,policy,runs,cycles,control,lease}` (+ `kairos:surplus:dirty`) | Idea queue, surplus policy, run records, reset-cycle readings, global control, runner lease (display copy) |
| SQLite | `shared_records` | `record_type` in `quota_state`, `routing_config`, `snapshot`; unique per `(workspace_id, record_type, logical_key)` |
| Runner host | `~/.kairos-runner/` | `config.json` (v2: `allowProviders` pinned to provider id and tool), `approvals.json`, `journal.jsonl`, `STOP`, `runs/{runId}/`; never synced (see [SECURITY.md](../SECURITY.md)) |
| SQLite | `record_revisions`, `migration_jobs`, `backup_snapshots`, `security_events`, `sessions`, `idempotency_keys` | History, jobs, audit |

Weekly snapshots sync as `snapshot` records with logical key `weekly-history:{weekKey}`; only the current week is pushed.

## Provider catalogue

Feature 007 replaces the fixed list of five services by providers the user declares. Spec: [`specs/007-dynamic-providers/`](../../specs/007-dynamic-providers/).

- **Identity.** Provider ids `p_` + 12 base32 characters, quota ids `q_` + 8, created once and never derived from a name (`src/providers/ids.js`). The five former ids exist only as read-only legacy references for old records.
- **Definition and runtime shape.** A provider (`src/providers/schema.js`) holds name, cost, colour, flags, note, a reset schedule (`weekly`, `monthly`, `custom` days, `none`), 1 to 8 quotas (`consumed_pct`, `remaining_pct`, `currency` with an optional `lowBalance`, optional `gates`), a declared fit per task and an optional surplus profile. `toRuntimeService` maps it to the shape `evaluateSurplus`, `getResetInfo`, snapshots and the routing engine read; `surplus` is exposed only when `surplusProblems` is empty.
- **Reducers.** `src/providers/catalogue.js` (`addProvider`, `updateProvider`, `removeProvider`, `duplicateProvider`, `reorderProviders`) are pure: they return `{ ok, catalogue, state, effects }` or `{ ok:false, errors:[{path,message}] }` with the same references, so nothing is half-created. A type change requires a new value; a schedule change with a recorded reset date needs confirmation. Persistence writes the quota-state patch first, then the definition.
- **Sync.** One `routing_config` record per provider (`provider:{id}`, a tombstone with the name at deletion instead of an HTTP delete) plus `catalogue-order`, through the generic `src/sync/recordSync.js` (the same core the surplus engine uses). A `409` never overwrites the other device's version: it is listed as a conflict (keep theirs or reapply mine); a tombstone beats any edit; records are validated on read and an invalid one is listed, never applied.
- **Display order never feeds a rule.** Recommendation, surplus selection and their explanations are identical for any order.
- **Unread quotas.** A quota with no stored value shows "No reading yet", is ignored by pressure helpers and snapshots, and excludes the provider from the tasks it gates.

## Surplus runner

Feature 006 adds an idea queue, a deterministic "which idea for this expiring quota" evaluation, and an optional runner. Spec: [`specs/006-surplus-runner/`](../../specs/006-surplus-runner/).

Provider rules on automated usage of subscriptions can change (FR-025). Runs are off by default, enabled per provider after acknowledging the disclosures, and any provider can go back to suggestion-only at any time. Since feature 007 the policy (schema v2) is keyed by provider id, a provider is eligible for surplus use only with a declared terminal tool, a weekly schedule and two designated percentage quotas, and the runner is authorised only by its own local allowance (`allow` command) pinned to provider id and tool; the shared catalogue can only restrict or select.

**`src/surplus/`** is pure ES modules (`now` and plain data in, plain data out; no `window`, `localStorage`, `fetch`, `fs` or `import.meta.env`), so the browser and the runner import the same code and the dashboard preview cannot disagree with the runner.

| Module | Role |
| --- | --- |
| `evaluation.js` | `evaluateSurplus`: rules R1 to R7, selection and ordering, explanation; versioned by `RULESET_VERSION` in `constants.js` |
| `ideas.js`, `policy.js`, `runs.js`, `cycles.js`, `cycleReadings.js` | Idea lifecycle and content version, policy defaults and validation, result decisions, reset-cycle readings and summary |
| `time.js`, `paths.js`, `instruction.js`, `quotaAge.js`, `runnerState.js` | Local-day and hard-stop helpers, folder classification and refused locations, copyable manual instruction, reading age, lease display helpers |
| `records.js`, `storage.js` | Logical-key builders and parsers, payload validators, load/save with injected storage, merge of server records, list of invalid records |
| `store.js`, `engine.js` | Pure idea/policy/control actions, and the framework-free local-first engine with shared sync (storage, API, clock and timers injected) |

**`runner/`** is a zero-dependency Node CLI (`npm run runner -- <command>`; commands in [`contracts/runner-cli.md`](../../specs/006-surplus-runner/contracts/runner-cli.md)). It is a client of the shared-state API, like the browser; it has no listening socket and the backend is unchanged.

| Module | Role |
| --- | --- |
| `loop.js` | Tick: heartbeat, pull, folder checks, `evaluateSurplus({mode:'auto'})`, local guardrails, claim, run, finalise; stop and quota watchers |
| `lease.js`, `config.js`, `approvals.js` | Designation plus single-process lease, local config and `--take-over`, local approvals keyed by idea id and content hash |
| `preflight.js`, `adapters/{claude,codex}.js` | Tool, flags and login-mode checks, env allowlist, invocation and result parsing |
| `workdir.js`, `journal.js`, `api-client.js` | Folder checks, disposable copy and diff, restart journal, versioned record calls |

**Shared records.** Ideas, policy, runs, cycles and the lease are stored as `routing_config` records with namespaced logical keys, so the backend needs **no schema or route change** (`shared_records.record_type` has a `CHECK` constraint; widening it means rebuilding a table with foreign keys, and released migrations are never edited). `applyServerRecords` ignores `routing_config`; `applySurplusRecords` in `storage.js` handles it.

| Logical key | Content | Writer |
| --- | --- | --- |
| `surplus-policy` | Per-provider policy (v2), protected hours, thresholds | Browser |
| `surplus-control` | `{autoRunEnabled, updatedAt}`; `false` is a global stop | Browser, runner (stop only) |
| `idea:{id}` | Idea; the runner changes only `status`, `serviceId` (a provider id), `lastRunId`, `updatedAt` | Browser, runner |
| `provider:{id}` | Provider definition or tombstone (feature 007) | Browser |
| `catalogue-order` | Display order of providers | Browser |
| `run:{id}` | Run record (with the provider name captured at the claim): created on claim, rewritten once on finalisation | Runner |
| `cycle:{providerId}:{resetDate}` | Last weekly reading before a reset | Browser, runner |
| `runner-lease` | Designation, heartbeat, display-only `approved` map | Runner |

Contracts: [006 `shared-records.md`](../../specs/006-surplus-runner/contracts/shared-records.md), [007 `shared-records.md`](../../specs/007-dynamic-providers/contracts/shared-records.md), [007 `runner-allowance.md`](../../specs/007-dynamic-providers/contracts/runner-allowance.md).

**Data flow.** The browser captures an idea (`localStorage` first, then synced) and evaluates in `preview` mode on open, on change and every 60 s. In shared mode the runner pulls the records every tick (default 15 min), evaluates in `auto` mode with local `folderChecks`, and only starts an idea whose content hash matches its **local** approval. It claims by a versioned `PUT` (`waiting -> running`, `409` means someone else moved it), runs the tool in a disposable copy, then writes the run and idea once and upserts the cycle record. The shared store never authorises a run (see [SECURITY.md](../SECURITY.md)). Derived values (pressure, eligibility, cycle consumption, retry counts) are never stored.

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
