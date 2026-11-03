# Research: surplus-runner

All "NEEDS CLARIFICATION" items from the spec's Assumptions are resolved here. Each decision lists what was chosen, why, and what was rejected. CLI facts were checked against `claude --help` and `codex exec --help` on 2026-11-03; flags that matter for safety are re-verified by a runner preflight and an adapter test (D5).

## D1. Where automatic runs execute

- **Decision**: A separate zero-dependency Node CLI in `runner/`, started by the user on their own machine (`npm run runner -- start`). It is a client of the shared-state API.
- **Rationale**: The CLI tools are signed in on the user's machine and the working folders exist there (spec Assumptions). A process with no listening socket has no network attack surface, which matters because shared-store access is unauthenticated (`docs/SECURITY.md`).
- **Alternatives**: (a) inside `backend/`: the server has neither the sign-ins nor the folders and is LAN-reachable. (b) Browser plus local helper service: adds a listening port that could spawn processes. (c) OS scheduler (launchd/cron) invoking the CLI directly: no shared state, no single-runner lease, harder to stop.

## D2. How the browser and the runner share rules

- **Decision**: Pure ES modules in `src/surplus/` take `now` and plain data and have no browser globals; the runner imports them by relative path.
- **Rationale**: One implementation of FR-007/FR-008 means the dashboard preview (FR-010) and the runner can never disagree (SC-002). Matches the repo rule "logic lives outside components, no `Date.now()` inside rules".
- **Alternatives**: Duplicate the rules in the runner (drift risk); publish an internal package (new tooling, no value for one repo).

## D3. Reset day basis (local midnight consistency)

- **Finding**: `getResetInfo` in `src/utils.js` computes `today` with `Date.UTC(getUTC*)`, i.e. the UTC calendar day. For a user in UTC+2 at 01:30 local, the dashboard counts from the previous day, while the spec requires local days (Assumptions, edge case on midnight).
- **Decision**: Change `getResetInfo` to derive today from the local calendar fields of `now` (`new Date(now.getFullYear(), now.getMonth(), now.getDate())` expressed as a UTC-midnight date for the existing arithmetic). The evaluation reuses `getResetInfo`, so both always agree. The reset takes effect at local 00:00 of `nextResetDate`.
- **Rationale**: One source of truth for the day count; it is a bug fix in a shared helper, covered by a regression test that fixes a timezone (`TZ` set in the test) and a `now` near midnight.
- **Alternatives**: A second day-count function used only by the evaluation (would let the dashboard and the notice disagree, which the spec forbids).
- **Impact**: Feature 003/004 behaviour changes only inside the few hours around local midnight. Their tests use mid-day or fixed `now` values; re-run to confirm. Because this changes what the reset-aware routing note says near midnight, the constitution's "routing-rule changes need a before/after scenario" applies: `src/utils.reco-reset.test.js` gets a scenario at 00:30 local (UTC+12) showing the note's day count before (previous UTC day) and after (local day) the fix.

## D4. Quota reading timestamps

- **Decision**: Per-quota timestamps stored in the same per-service state map under keys `__ts_{quotaId}` (ISO string or `null`), next to `__last_reset_date`. `applyQuotaUpdate` stamps the key with an injected `now`; a new `confirmQuotas(state, serviceId, now)` stamps every quota of a service without changing values (FR-031).
- **Rationale**: Reuses the existing sync path (`quota_state` records with logical key `{service}:{key}`), so timestamps share persistence, scope and conflict handling with the values (FR-003, FR-031). Per-quota stamps are needed because editing only the weekly value must not make a stale 5-hour reading look fresh (spec edge case). Existing code iterates `svc.quotas`, so extra keys are ignored by pressure, snapshots and rules.
- **Alternatives**: One service-level stamp (breaks the stale-session-reading rule); a separate record type (a second sync path to keep consistent).
- **Follow-up**: `buildDefaultEntries` / `buildDefaultState` / `localExport` / `resetAll` must include the new keys; covered by tasks and tests. Imported-from-localStorage states without stamps load as `null` = never confirmed = not fresh.

## D5. Official terminal tools and containment

- **Decision**: Adapters per tool, behind one interface (`buildInvocation({prompt, cwd}) -> {cmd, args, env}`):
  - Claude: `claude -p <prompt> --output-format json --permission-mode dontAsk` with an explicit `--allowedTools` list limited to file read/search/edit tools (no shell tool), `--max-turns` bound, `cwd` = disposable copy. Anything not allowed is denied because there is no human to ask.
  - Codex: `codex exec` with `--sandbox workspace-write`, approvals set to never, `--cd` = disposable copy, `--skip-git-repo-check` only if the copy is not a repo.
  - Exact flag spellings are pinned in the adapter and checked by a preflight (`<tool> --help` contains the required flags) so a CLI change fails closed with a clear reason.
- **Billing guard (FR-015)**: two layers. (1) Environment: preflight refuses to start when `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `CODEX_API_KEY` is set in the runner environment, and the child environment is built from an allowlist (PATH, HOME, locale, TMPDIR), not inherited wholesale. (2) Login mode: preflight runs `claude auth status --json` and `codex login status` (both exist in the installed CLIs, checked 2026-11-03) and refuses unless the reported login method is the subscription sign-in, not an API key stored in the tool's own config. If the status output cannot be parsed or does not name a login method, the guard fails closed with `billing_guard`. The runner never opens credential files itself and never logs the child environment or the raw status output.
- **Containment (FR-017)**: cwd in a disposable copy, no shell tool for Claude, workspace-write sandbox for Codex. Residual risk: the OS user can still reach other files if a tool's own permission model fails. v1 documents this in `docs/SECURITY.md` and adds a manual canary check in the quickstart; an OS sandbox profile (macOS `sandbox-exec`) is a recorded follow-up, not a v1 dependency.
- **Alternatives**: Run with tool defaults (unsafe unattended); Docker per run (adds a dependency and cannot use the host's signed-in CLI session).

## D6. Shared-store record types

- **Finding**: `shared_records.record_type` has a SQLite `CHECK` limited to `quota_state`, `routing_config`, `snapshot` (migration 001). `routing_config` is not used anywhere in code today.
- **Decision**: Store all new data as `routing_config` records with namespaced logical keys (`surplus-policy`, `surplus-control`, `idea:{id}`, `run:{id}`, `cycle:{serviceId}:{resetDate}`, `runner-lease`). `applyServerRecords` already ignores other types, so a dedicated apply function handles these.
- **Rationale**: Changing a CHECK constraint in SQLite means rebuilding the table, which has foreign keys from `record_revisions`; the repo rule is never to edit released migrations. Namespacing gives the same isolation with no migration.
- **Alternatives**: Migration 002 rebuilding `shared_records` with more types (cleaner naming, real risk to live data, no functional gain); a new table (new routes, repo and tests for no gain).

## D7. Authorisation without trusting the shared store (FR-013, FR-014)

- **Decision**:
  - The shared store carries ideas, an `approvalRequested` flag, policy and control only as inputs. The runner authorises a run solely from its **local** approvals file, which maps idea id to the SHA-256 of the canonical JSON of `{text, context, resolvedFolder}`. A run starts only if the hash of the idea as fetched now equals the stored hash. Any edit changes the hash, which withdraws the approval automatically (FR-029).
  - Approval is `npm run runner -- approve`: a terminal prompt that prints the exact text, context and resolved folder and requires typing `yes`. There is no HTTP endpoint for approval.
  - The dashboard shows an idea as "approved" only from a display-only map the runner publishes in its lease record (`approved: {ideaId: contentVersion}`); that map is never read back for authorisation.
  - Runner designation (FR-014: exactly one designated device) is an explicit local action and is separate from the lease. `runner config` creates a device id; the first `runner start` in a workspace writes `designatedDeviceId` into the `runner-lease` record and that value survives lease expiry. Another device's `start` exits with code 3 ("designated runner is <name>") even when the lease has expired. Moving the designation needs `runner config --take-over` run on the new device, an explicit local action that overwrites `designatedDeviceId` (the old runner then loses the lease on its next heartbeat). The lease itself (heartbeat, `expected_version`, expiry after 3 missed heartbeats) only prevents two processes of the designated device. A forged lease or designation can at worst stop the real runner (a restricting outcome), never cause a run, because the local approval hash and local config are still required.
  - Stop is restricting-only: the control record `surplus-control {autoRunEnabled:false}` written by any client, a local `STOP` file, or Ctrl-C all stop the runner. Re-enabling is local (`runner start`) plus the dashboard toggle.
- **Alternatives**: Shared-store flag as approval (explicitly forbidden by FR-013); a local HTTP approval UI (adds a listening port); WebCrypto in the browser to sign approvals (unavailable on plain-HTTP LAN origins).

## D8. Idempotence and restarts (FR-014, FR-018)

- **Decision**: Claiming an idea is an optimistic-concurrency update `waiting -> running` (409 means someone else moved it). The runner also appends a local journal entry before spawning and after exit. On start, any journal entry without an end marker, or any idea left `running` by this runner's device, is finalised as `failed: interrupted` and returned to a retriable state. "Failed idea not retried automatically more than once per reset cycle" is derived from run records (auto runs of that idea in that cycle with status failed or interrupted), not stored as a counter.
- **Rationale**: Combines server-side compare-and-set (cross-device) with a local journal (crash safety), without new infrastructure.

## D9. Limits on a running process (FR-016)

- **Decision**: At start the runner computes `hardStopAt = min(now + maxDuration, protectedHoursStart, resetDayStart)`; a timer kills the process group at that time (SIGTERM, then SIGKILL after 10 s). While running, two watchers apply: a **stop watcher every 5 s** (the `STOP` sentinel file, and a lightweight read of the `surplus-control` record) so the global stop ends the process within 5 s of reaching the runner (SC-007, US3 scenario 3); and a **quota watcher every 60 s** that re-pulls quota state and stops the run when the weekly remaining is at or below the reserve, or when the lease or designation is lost. Consumption during the run is recorded as the size-class estimate (FR-020), because actual usage is not observable.
- **Alternatives**: Parse provider usage output (unofficial and unstable, rejected by the spec's Assumptions).

## D10. Disposable copy (FR-017, FR-030)

- **Decision**: `fs.cp` into `~/.kairos-runner/runs/{runId}/work` with a filter that applies default exclusions (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `.gnupg`, `credentials*`, `secrets*`, `node_modules`, `.git/hooks`), overridable in `config.json` and shown before approval. Size is measured with a pre-walk applying the same filter; over 1 GB is refused. Refused roots: `/`, the home folder itself, and system locations (`/etc`, `/usr`, `/bin`, `/sbin`, `/System`, `/Library`, `/var`, `/private`, `/opt`, `/Volumes` root). Symlinks are not followed outside the folder. The proposal is a unified diff of copy versus original, computed read-only, stored (capped) in the run record. The original folder is never written.
- **Alternatives**: `git worktree` (requires a repo, shares objects with the original); no copy and rely on tool permissions (violates FR-017).

## D11. Stored output size

- **Decision**: Run records are immutable and capped at 256 KB of output plus 256 KB of diff in the shared store (truncated with an explicit marker); the full output and the copy stay in `~/.kairos-runner/runs/{runId}/`, removable with `runner clean`. Local-only (non-shared) mode has no runs at all.

## D12. Evaluation cadence and clock

- **Decision**: Runner tick every 15 minutes (configurable) plus a tick on start; the dashboard evaluates on open, on quota change and on a 60 s timer while visible. `now` is read once per tick at the edge and passed in. Windows missed while the runner is down are skipped, never replayed after the reset (spec edge case).

## D13. Cost estimates and eligibility arithmetic

- **Decision**: Quotas are first normalised to remaining percentage with `100 - getConsumedPct(...)`. Weekly rule: `remaining >= reserve + cost(size)`. Defaults: reserve 20, cost small/medium/large = 3/8/15, session minimum room 30, session reading max age 5 h, freshness 12 h, window 2 days, max run 60 min, context limit 10,000 characters, copy limit 1 GB.
- **Candidate order**: priority (high, normal, low), then the largest size class whose cost fits `remaining - reserve`, then oldest `createdAt`; ties on service by soonest reset then `SERVICES` order. Ideas with a failing folder check are skipped with a reason.

## D14. Coexistence with the reset-aware recommendation (feature 004)

- **Decision**: The surplus notice is rendered beside the recommendation. A scenario test asserts that whenever a service is surplus-eligible, the routing rules do not treat that service as blocked, and that the 004 note "Resets in Nd, spend it now" is consistent with the notice. No change to `rules.js`.

## D15. Spec gaps found while planning (no spec change needed)

- Reset-cycle consumption (FR-032) is derived from run records tagged with a `cycleKey`, so only the last reading is stored; this is consistent with "do not store derived data".
- Result decisions (accept, discard, re-queue) are stored on the idea, because run records are immutable (FR-020).
