# Security

## Reporting a vulnerability

Do **not** open a public issue. Contact the maintainer privately through the Codeberg profile of [@medenor](https://codeberg.org/medenor) and include the version or commit, reproduction steps and impact. Only the latest `main` is supported.

## Threat model

Kairos is a **personal / home-lab tool**. The frontend is static and stores quota numbers in the browser. The optional backend is meant for a **trusted LAN** and holds only quota values and weekly snapshots, no secrets or personal data beyond a username. The idea queue added in feature 006 puts idea text in that same store, and the optional [runner](#surplus-runner) can execute approved ideas on one machine; both are covered below.

## What the shared backend does and does not protect

| Control | Status |
| --- | --- |
| Network restriction | `LAN_ONLY=true` (default) rejects clients outside loopback and RFC1918 subnets (`ALLOWED_SUBNETS`); denials are logged as `security_events`. IPv4 only. |
| Authentication | `POST /auth/login` issues a bearer session (scrypt-hashed passwords, 12 h TTL). **Data routes (`/records`, `/sync`, `/migrations`, `/backups`) do not require it.** Access control is the LAN restriction alone ("local trust"). |
| CORS | `Access-Control-Allow-Origin: *`. Any web page opened on a LAN machine can call the API. |
| Default account | An empty database is seeded with user `owner` / password `password123` (`seedDemoData`). Change or remove it before exposing the server beyond your own machine. |
| SQL | The backend runs the `sqlite3` CLI with string-built SQL; dynamic values are escaped by `quoteSql()`. There are no prepared statements, so any new query that skips `quoteSql()` is an injection risk. |
| TLS | None. Terminate TLS in a reverse proxy if traffic leaves a trusted segment. |
| Rate limiting | None. |

`docker/docker-compose.shared.yml` sets `LAN_ONLY=false` and publishes ports `8888`/`5273`: never expose it to the internet.

## Surplus runner

The `runner/` CLI (feature 006) is optional. It is the only component that starts processes: it runs a signed-in `claude` or `codex` terminal tool on an idea, inside a disposable copy of a working folder, while a subscription quota would otherwise expire. It has no listening socket and is a client of the shared-state API. Design rationale: [`specs/006-surplus-runner/research.md`](../specs/006-surplus-runner/research.md) (D5, D7, D10).

### Who can make it run something

| Question | Answer |
| --- | --- |
| Where is a run approved? | On the runner device only. `npm run runner -- approve` prints the exact text, context, resolved folder and copy exclusions and requires typing `yes`. There is no HTTP endpoint or dashboard button that approves. |
| What does an approval cover? | The SHA-256 of the canonical JSON (keys sorted) of `{text, context, resolvedFolder}` (`resolvedFolder` is `null` for an idea without a working folder), stored in `~/.kairos-runner/approvals.json`. Any edit to those fields changes the hash and withdraws the approval. The runner re-fetches the idea right before the claim and recomputes the hash from that fetch; the claim is a versioned `PUT`, so an edit between fetch and claim returns `409` and starts nothing. |
| Does the shared store ever authorise? | No. `approvalRequested` on an idea and the `approved` map in the `runner-lease` record are display inputs only; the runner never reads them as permission. `surplus-control` can only stop (`autoRunEnabled=false`); it cannot start anything without the runner's local allowance, local approval and the per-provider policy. The provider catalogue (`provider:{id}`) is untrusted data too: it selects and restricts (which providers exist, their tool and quotas) but never allows. Only a provider id **and tool** pinned in the runner's local `allowProviders` (written by `npm run runner -- allow`, never synced) can run, so a provider written straight into the store does not run, and an allowed provider whose tool is switched in the store stops until you allow it again. Anyone who can write the store can at worst stop the runner (or stop the run of a provider by removing it, switching it off or changing its tool), change what an unapproved idea says (which then needs a new approval) or fill the queue. |
| Which device may run? | One designated device per workspace. The first `start` writes `designatedDeviceId` into the `runner-lease` record; it survives lease expiry, so another device exits with code 3 even when the lease is stale. Moving it needs `runner config --take-over` on the new device; the old runner loses the lease at its next heartbeat. The lease (heartbeat 60 s, expiry 180 s, `expected_version`) only prevents two processes of the same device. A forged designation or lease can stop the real runner, never start a run. |
| How do I stop it? | Dashboard "stop automatic runs" (`surplus-control`), `npm run runner -- stop` (writes the `STOP` file and the control record), the `STOP` file by hand, or Ctrl-C. Checked before every run and every 5 s during one: the process group gets SIGTERM, then SIGKILL after 10 s. Re-enabling needs `runner start` locally plus the dashboard switch. |

### Exposure through the unauthenticated store

Idea text, context and working-folder paths are stored as `routing_config` records, and run output and diffs (each capped at 256 KB) as `run:{id}` records. Data routes do not require authentication (see the table above), so every device on the LAN, and any web page opened on one (CORS `*`), can read them and can create or edit ideas. Do not put secrets in an idea or its context; the capture form says so in shared mode. Idea text and the files of the copy also go to the provider through the tool, only for an idea approved for that provider. Provider names, flags, notes and costs are never sent to an AI provider; they are stored with the other shared records (visible on the LAN like ideas), so keep secrets out of them too. Local-only mode keeps ideas in `localStorage` and has no runs.

### Billing guard

Runs must use the subscription, never an API key. Two layers, both checked by the preflight before each automatic run, both failing closed with reason `billing_guard`:

1. **Environment.** The runner refuses to start a run when any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` or `CLAUDE_CODE_USE_VERTEX` is set, even empty. Nothing is spawned in that case.
2. **Login mode.** It runs `claude auth status --json` and `codex login status` and parses the result. Claude must report `authMethod: "claude.ai"` on the first-party provider; Codex must report "Logged in using ChatGPT". An API-key login, an unreadable output, a missing field or a failed status command is refused. The runner never opens the tools' credential files and never logs the status output or the child environment.

The Claude adapter also classifies a billing error reported by a tool as `billing_guard`. The guard depends on the status output of the installed CLI versions: a CLI update that changes it makes runs fail closed, not open.

### Containment: what is and is not enforced

Enforced by the runner:

- The tool runs with its working directory in `~/.kairos-runner/runs/{runId}/work`, a copy. The original folder is only read; the proposal is a diff computed read-only. The runner does not copy the originals back.
- Refused folders: `/`, the home folder itself, `/etc`, `/usr`, `/bin`, `/sbin`, `/System`, `/Library`, `/var`, `/private`, `/opt` and `/Volumes`, checked on the typed path and on its real path. Copies over 1 GB are refused. Symlinks that leave the folder are not copied.
- Default exclusions, never copied: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `.gnupg`, `credentials*`, `secrets*`, `node_modules`, `.git/hooks`. The list is editable with `runner config` and shown before approval. It is name-based: a secret in a file with another name, or inside a source file, is copied.
- An idea without a working folder (FR-017) is limited to drafts that need no project files. It runs in an empty scratch directory `~/.kairos-runner/runs/{runId}/work`: nothing from the user's disk is copied, and the prompt says that no project files exist. It is approved on the runner like any other idea, with `resolvedFolder` set to `null` in the hash and a "No working folder" notice in the prompt; giving it a folder later changes the hash and needs a new approval. Files the tool creates are listed as added in the proposal for review. A relative folder with no projects base folder is not folder-less: it stays an error (`folder_missing_base`).
- Child environment built from an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, locale, `TERM`, `TMPDIR`, `TZ`, XDG directories, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, certificate variables, `LC_*`). `HOME` is passed so the tool finds its own sign-in. Anything else, including cloud and API credentials, is dropped.
- The prompt contains the idea text and context only: no quota data, no other ideas. Hard limits: one run at a time, a hard stop at the earliest of the maximum duration, the next protected-hours start and the reset day, and a quota watcher every 60 s.
- Tool flags: Claude runs in print mode with `--permission-mode dontAsk`, path-scoped allow rules `--allowedTools 'Read(./**),Edit(./**)'` (anchored at the working directory, so the copy; no bare tool names, no shell tool), explicit `--disallowedTools` deny rules for credential folders under the home folder (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.claude`, `~/.codex`, `~/.netrc`, `~/.npmrc`) and `--max-turns 40`. A canary run on 2026-11-04 (claude 2.1.317, after this fix) could not read or write outside the copy by absolute or relative path, and still edited a file inside it; this is one run, not proof. Claude Code states that an allow rule through a symlink only matches when the link and its target are both inside the scope, and that deny rules also match a symlink's target. Codex runs `codex exec --ignore-user-config --ignore-rules -c 'approval_policy="never"' -c 'approvals_reviewer="user"' --sandbox workspace-write --cd <copy> --skip-git-repo-check`: your Codex config and rules are ignored (a personal auto-review or allow rule cannot escalate out of the sandbox), approvals are pinned to never, and writes outside the copy are blocked. A hardened canary on 2026-11-04 (codex-cli 0.166.0) confirmed blocked writes outside the copy, approval `never`, and a working in-copy edit, but **reads outside the copy still succeed** (see below). The preflight checks that the installed tool lists these flags and refuses otherwise.

Not enforced, so a risk that remains:

- **Codex reads are NOT contained.** `workspace-write` grants read access to `/`, so Codex can read files outside the copy, including `~/.ssh` and other credential files reachable as your OS user; in the hardened canary a decoy marker under a fake `.ssh/config` appeared in the output. This was accepted by the user and mitigated by a gate: the runner skips Codex ideas in the automatic loop (skip reason `codex_reads_uncontained`) unless `"allowCodexAuto": true` is set in `~/.kairos-runner/config.json` (default `false`). Opt in only if you accept that an approved idea could make Codex read and print any file you can read. Claude is contained (scoped Read/Edit rules plus explicit denies) and is not affected by this setting. `~/.codex/rules/default.rules` is irrelevant to runner runs because of `--ignore-rules`.
- Claude's file tools are scoped by permission rules, not an OS boundary. Bash is not offered, but a Claude Code bug or an unlisted tool path could still escape; Glob and Grep are covered only on a best-effort basis by `Read` rules.

- The copy and the flags are **not a sandbox**. The tool process runs as your OS user. Containment relies on the tool's own permission model: Claude's allow-list is a permission rule, not an OS boundary, and Kairos adds no OS sandbox profile (a macOS `sandbox-exec` profile is a recorded follow-up). A bug in the tool, or a prompt that makes it misbehave, could read or write files outside the copy, including the sign-in files reachable through `HOME`.
- Approval limits what runs, not what the idea asks for. Approve only ideas whose text you wrote or reviewed.
- Output and diffs are drafts. The dashboard renders them as plain text and nothing applies them; review before copying anything into a real folder.
- The runner records a size-class estimate of consumption, not measured usage.

### Local files

Everything lives under `~/.kairos-runner/`: the directory is `0700`, and `config.json`, `approvals.json` and `journal.jsonl` are `0600`. They hold the device id, API base, workspace id, approval hashes with a preview of each approved text, and a run journal for restart recovery. They are never synced. Disposable copies and full outputs sit in `runs/{runId}/` until `runner clean`; the copy contains your project files, so clean it when a run is reviewed. The runner writes nowhere else except HTTP calls to the configured API base.

## Known follow-ups

Tracked here until they become issues:

- Enforce `requireAuth` on data routes (or document and test "local trust" as a deliberate mode). This also matters more since idea text and run output are stored there.
- Remove the default `owner` account in favour of first-run credential setup.
- Restrict CORS to a configurable origin list.
- Run the runner's tool process under an OS-level sandbox (see [Surplus runner](#surplus-runner)).
- Replace the `sqlite3` CLI shell-out with a driver using prepared statements.
- Upgrade Vite 5 (dev-server advisory GHSA-67mh-4wv8-2f99 via esbuild, development only; production dependencies report 0 vulnerabilities).

## Dependencies

Runtime dependencies are `react` and `react-dom` only. CI audits them weekly (`npm audit --omit=dev --audit-level=high`). Dev-tooling advisories are reviewed manually.
