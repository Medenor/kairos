# Surplus runner

Optional local CLI that starts approved ideas with your subscription-signed-in `claude` or `codex` tool when a provider you declared has quota that would expire unused. Zero dependencies, Node 26 built-ins only.

```bash
npm run runner -- config     # first-time setup, `--take-over` to designate this device, `--exclusions` to edit exclusions
npm run runner -- allow     # list the providers that can run, or `allow <name-or-id>` to allow one on THIS device (pinned to its tool)
npm run runner -- disallow <name-or-id>  # remove a provider from the local allowance
npm run runner -- approve    # list ideas awaiting approval; `approve <id>` shows the exact content and asks for `yes`
npm run runner -- start      # run the loop (exit codes: 0 stopped, 1 usage, 2 preflight or no shared mode, 3 lease or designation)
npm run runner -- status
npm run runner -- stop       # writes the STOP file and sets the global stop in the shared store
npm run runner -- approvals  # list, or `revoke <id>`
npm run runner -- clean      # remove old disposable copies; `--all` removes every run
```

A provider runs only if it is allowed here: `allow` shows the provider and its tool, asks you to type `yes`, and stores its id **and tool** in `config.json` (`allowProviders`, never synced). Nothing written to the shared store can allow a provider; if the catalogue later says another tool, nothing runs until you allow it again, and a run in progress is stopped (partial output kept) when its provider is removed, switched off or re-tooled. A `config.json` from the previous version loads with nothing allowed; its `allowServices` is kept under `legacyAllowServices` and ignored.

Local files live in `~/.kairos-runner/` (override with `KAIROS_RUNNER_HOME`), directory mode 0700 and files mode 0600.

Containment differs by tool. Claude is contained to the disposable copy (path-scoped `Read`/`Edit` rules and credential-folder denies). Codex runs hardened (`--ignore-user-config --ignore-rules`, approvals never, `workspace-write`): writes outside the copy are blocked, but **reads outside the copy are not contained**. For that reason Codex ideas are skipped by the automatic loop (reason `codex_reads_uncontained`) unless you opt in by setting `"allowCodexAuto": true` in `~/.kairos-runner/config.json` (default `false`; the `config` wizard does not prompt for it). Claude runs are unaffected.

Contracts: [`specs/006-surplus-runner/contracts/runner-cli.md`](../specs/006-surplus-runner/contracts/runner-cli.md), [`specs/007-dynamic-providers/contracts/runner-allowance.md`](../specs/007-dynamic-providers/contracts/runner-allowance.md). Security notes: [`docs/SECURITY.md`](../docs/SECURITY.md). Tests: `npm run test:runner`.
