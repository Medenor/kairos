# Surplus runner

Optional local CLI that starts approved ideas with your subscription-signed-in `claude` or `codex` tool when a service has quota that would expire unused. Zero dependencies, Node 20 built-ins only.

```bash
npm run runner -- config     # first-time setup, `--take-over` to designate this device, `--exclusions` to edit exclusions
npm run runner -- approve    # list ideas awaiting approval; `approve <id>` shows the exact content and asks for `yes`
npm run runner -- start      # run the loop (exit codes: 0 stopped, 1 usage, 2 preflight or no shared mode, 3 lease or designation)
npm run runner -- status
npm run runner -- stop       # writes the STOP file and sets the global stop in the shared store
npm run runner -- approvals  # list, or `revoke <id>`
npm run runner -- clean      # remove old disposable copies; `--all` removes every run
```

Local files live in `~/.kairos-runner/` (override with `KAIROS_RUNNER_HOME`), directory mode 0700 and files mode 0600.

Contract: [`specs/006-surplus-runner/contracts/runner-cli.md`](../specs/006-surplus-runner/contracts/runner-cli.md). Security notes: [`docs/SECURITY.md`](../docs/SECURITY.md). Tests: `npm run test:runner`.
