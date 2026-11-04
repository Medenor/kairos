# Contract: runner CLI

Entry: `npm run runner -- <command>` (script `node runner/index.js`). Node 20, no dependencies. Needs `claude` and/or `codex` on `PATH`, signed in by the user.

## Commands

| Command | Purpose | Notes |
| --- | --- | --- |
| `config` | Create or edit `~/.kairos-runner/config.json` (device id and name, API base, workspace id, projects base folder, allowed services, copy exclusions). Interactive: shows the current exclusion list and lets the user add or remove entries (FR-030) | Explicit local action. `config --take-over` makes this device the designated runner, replacing another (FR-014) |
| `start` | Claim designation on first use, take the lease and loop: heartbeat, pull, evaluate, preflight, claim, run, finalise | Prints the disclosures on first start for each service; refuses without `config`; exits 3 if another device is designated (even when its lease expired) |
| `approve` | List ideas that requested approval; for each, print exact text, context, resolved folder and exclusions; require typing `yes` | Writes `approvals.json`. This is the only way to approve (FR-013) |
| `approvals` | List and revoke local approvals | |
| `status` | Print lease state, last evaluation with rule outcomes, pending approvals, active run | Read-only |
| `stop` | Create the `STOP` sentinel and write `surplus-control autoRunEnabled=false` | Effective before the next run; a running process is terminated within 5 s |
| `clean [runId\|--all]` | Remove disposable copies and local outputs | FR-017 |

Exit codes: 0 ok; 1 usage or config error; 2 preflight failure; 3 another device is designated or holds the lease.

## Tick algorithm

1. Read `now` once. If `STOP` exists or `control.autoRunEnabled` is false, heartbeat only.
2. Heartbeat the lease. `designatedDeviceId` different from this device, or a 409 against a live lease of another device, means exit 3. A tick that begins after the reset day has started for a service simply finds that service ineligible (R2): windows missed while the runner was down are skipped, never replayed.
3. Pull records; build `state`, `policy`, `ideas`, `runs`.
4. Run `folderChecks` locally for waiting ideas (exists, readable, not refused, size under limit). Relative path without a base folder is `folder_missing_base`. An idea without a working folder passes with `resolvedFolder: null` and runs in an empty scratch directory (FR-017).
5. `evaluateSurplus({ mode: 'auto', ... })`.
6. If an idea is selected: verify local guardrails (service `autoRunEnabled` and `disclosuresAckAt`, `allowServices`, for a Codex service `allowCodexAuto` true in `config.json`, approval hash equal, no active run, preflight ok). On any failure record the reason in the status output and in an `evaluation-skipped` line of the journal; start nothing.
7. Claim: `PUT idea waiting->running` (409 aborts), `POST run` (status `running`), journal `start`.
8. Build the disposable copy (an empty scratch directory for an idea without a working folder); spawn the adapter command with the allowlisted environment; arm the hard-stop timer; start the **stop watcher (every 5 s: `STOP` file and `surplus-control`)** and the **quota watcher (every 60 s: reserve rule, lease and designation)**.
9. On exit, stop signal or timer: capture output (capped), compute the diff, `PUT run` once with final status, `PUT idea` to the matching status, upsert the cycle record, journal `end`.

## Adapter contract

```js
// runner/adapters/<tool>.js
export const tool = 'claude' | 'codex'
export function requiredFlags(): string[]            // checked against `<tool> --help` in preflight
export function buildInvocation({ prompt, cwd, maxMinutes }): { cmd, args, env }
export function parseResult({ code, stdout, stderr }): { status, needsInput, failureReason, text }
```

- `prompt` is built from the idea text and context only. It states that the session is non-interactive, that no information can be requested, and that results are drafts. No quota data and no other ideas are included (FR-024).
- Claude: print mode with JSON output, `--permission-mode dontAsk` (denies anything not allowed), path-scoped `--allowedTools Read(./**),Edit(./**)` (anchored at the copy, no bare tool names, no shell), `--disallowedTools` Read denies for credential folders reachable through `HOME` (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.claude`, `~/.codex`, `~/.netrc`, `~/.npmrc`), a turn limit. Codex: `exec --ignore-user-config --ignore-rules -c approval_policy="never" -c approvals_reviewer="user" --sandbox workspace-write --cd <copy> --skip-git-repo-check`, so the user's config and rules cannot bypass the sandbox. Writes outside the copy are blocked for Codex but reads are not contained (`workspace-write` grants read on `/`), hence the `allowCodexAuto` gate in tick step 6.
- `env` is built from an allowlist. Preflight fails with `billing_guard` if `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `CODEX_API_KEY` is present, or if `claude auth status --json` / `codex login status` reports a login method other than the subscription sign-in (or cannot be parsed: fail closed), and with `not_signed_in` or `tool_missing` per tool check.

## Preflight reasons

`tool_missing`, `flags_unsupported`, `not_signed_in`, `billing_guard`, `folder_error`, `no_shared_mode`, `lease_held`, `not_approved`, `service_not_allowed`, `disclosures_missing`, `codex_reads_uncontained` (a Codex idea while `allowCodexAuto` is not true; Claude is unaffected). Each maps to a human-readable message shown by `status` and stored in the evaluation that triggered the attempt.

## Local file safety

Config, approvals and journal are created with mode 0600 in a 0700 directory. The runner never reads credential files, never logs the child environment, and never writes outside `~/.kairos-runner/` except for HTTP calls to the configured API base.
