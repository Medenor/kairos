# Testing

Runner: the built-in `node:test` (no Jest/Vitest). Nothing to install beyond `npm ci`.

```bash
npm test                 # frontend + backend + runner
npm run test:frontend    # node --test src/        (pure logic, no DOM)
npm run test:backend     # backend: node --test "tests/**/*.test.js"
npm run test:runner      # node --test runner/     (runner CLI, fake tool, fake API)
node --test src/utils.reset.test.js          # single file
node --test --test-name-pattern="tiebreak" src/   # single test by name
```

## Where tests live

| Area | Location | Notes |
| --- | --- | --- |
| Pure logic, rules, state transitions | `src/**/*.test.js` next to the code | Name by feature: `utils.reco-reset.test.js` |
| Cross-module scenarios | `src/*.integration.test.js` | e.g. `weekly-history.integration.test.js` |
| Surplus logic | `src/surplus/*.test.js` (run by `test:frontend`) | Rule tests per FR-007 rule, ordering, scenarios (`evaluation.scenario.test.js`) |
| Runner | `runner/*.test.js`, `runner/loop.testkit.js` | Loop lifecycle, recovery, guardrails, approvals, preflight, workdir |
| Runner fixtures | `runner/fixtures/fake-cli.js`, `fake-api.js` | See below |
| Backend contract | `backend/tests/contract/` | API shape, status codes |
| Backend integration | `backend/tests/integration/` | Named by user story (`us1-…`, `us2-…`) |
| Backend helpers | `backend/tests/helpers/` | `test-app.js`, `test-db.js`, `fixtures.js` use a throwaway DB |
| Container checks | `tests/integration/docker/*.sh` | Need Docker; run with `npm run docker:test:us1..3` |

## Rules

- **Behavior change => a test that fails if it regresses** (constitution III). Bug fix => regression test first.
- **Routing-rule changes** need at least one before/after scenario showing the recommendation change.
- Tests must be deterministic: inject `now`, never read the real clock or `localStorage` in pure-logic tests.
- Backend tests create their own temporary SQLite DB through the helpers; never point tests at `backend/data/`.
- **Time zones.** Day-based logic uses the local calendar day, so tests that depend on it set `process.env.TZ` explicitly (restore it in `after`/`afterEach`) and pass a fixed `now`; never rely on the machine's zone. See `src/surplus/time.test.js` and `src/utils.reco-reset.test.js`.
- UI-only behavior without automation: document manual verification in the PR.
- The `sqlite3` CLI must be on `PATH` for backend tests.

There is no coverage gate yet; keep new code covered by the tests above.

## Runner tests

- **No real tools, no network.** `fixtures/fake-cli.js` writes an executable `claude`/`codex` stand-in whose behavior (output, exit code, sleep, files written, `--help` text, login mode) is a JSON file; every call is recorded (argv, cwd, env) so tests assert on the exact flags and the allowlisted child environment. `fixtures/fake-api.js` is an in-memory shared-state records API on an ephemeral `127.0.0.1` port with the real routes, error envelope and `409` behavior. `loop.testkit.js` wires both with a manual clock and scheduler.
- **Temporary folders go under `<repo>/.test-tmp/`** (gitignored), not `os.tmpdir()`: on macOS the OS temp dir is under `/var`, which the runner refuses as a working folder, so a test using it would fail the folder check. Clean up what you create.
- Tests never touch the real `~/.kairos-runner/`: pass a `baseDir` inside `.test-tmp/`.
- A guardrail change (billing guard, approval hash, refused folders, stop) needs a test that proves the refusal.

## Feature 007 suites (dynamic providers)

- Fixtures: `src/providers/fixtures/sampleProviders.js` (valid providers, `sequentialIds`, `sampleInput`), `legacyData.js` (stored shapes of the fixed-provider build: state, policy v1, snapshot v1, run, cycle, idea, runner config), `legacyServices.js` (the former service list as test input for history and export suites).
- Routing: `src/routing/engine*.test.js` (rules, no-pick cases, determinism under shuffling, reset buckets, scale), `routing.reference.test.js` (before/after grid against the former rule table in `fixtures/`, every divergence listed in `INTENDED_DIFFERENCES`), `no-provider-literals.test.js` (guard).
- Providers: `src/providers/*.test.js` (ids, schema, tie-break, runtime mapping, records, storage, reducers, engine with a fake server from `src/sync/fakeServer.testkit.js`).
- Runner: `loop.guardrails.providers.test.js` (store writes never authorise a run), `loop.lifecycle.providers.test.js` (stop watcher on removal, switch-off, tool change), `index.providers.test.js` (`allow`, `disallow`, `status`), `config.providers.test.js`. `loop.testkit.js` declares a real provider record and a pinned allowance for its world.
- Backend: `backend/tests/contract/provider-records.contract.test.js` and the provider case of `us3-backup-restore.test.js`.
- Tests that depend on the day set `process.env.TZ` and restore it; `test:runner` suites that start fake tools can take several seconds, run a single file with `node --test --test-timeout=20000 runner/<file>`.
