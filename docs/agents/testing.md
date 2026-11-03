# Testing

Runner: the built-in `node:test` (no Jest/Vitest). Nothing to install beyond `npm ci`.

```bash
npm test                 # frontend + backend
npm run test:frontend    # node --test src/        (pure logic, no DOM)
npm run test:backend     # backend: node --test "tests/**/*.test.js"
node --test src/utils.reset.test.js          # single file
node --test --test-name-pattern="tiebreak" src/   # single test by name
```

## Where tests live

| Area | Location | Notes |
| --- | --- | --- |
| Pure logic, rules, state transitions | `src/**/*.test.js` next to the code | Name by feature: `utils.reco-reset.test.js` |
| Cross-module scenarios | `src/*.integration.test.js` | e.g. `weekly-history.integration.test.js` |
| Backend contract | `backend/tests/contract/` | API shape, status codes |
| Backend integration | `backend/tests/integration/` | Named by user story (`us1-…`, `us2-…`) |
| Backend helpers | `backend/tests/helpers/` | `test-app.js`, `test-db.js`, `fixtures.js` use a throwaway DB |
| Container checks | `tests/integration/docker/*.sh` | Need Docker; run with `npm run docker:test:us1..3` |

## Rules

- **Behavior change => a test that fails if it regresses** (constitution III). Bug fix => regression test first.
- **Routing-rule changes** need at least one before/after scenario showing the recommendation change.
- Tests must be deterministic: inject `now`, never read the real clock or `localStorage` in pure-logic tests.
- Backend tests create their own temporary SQLite DB through the helpers; never point tests at `backend/data/`.
- UI-only behavior without automation: document manual verification in the PR.
- The `sqlite3` CLI must be on `PATH` for backend tests.

There is no coverage gate yet; keep new code covered by the tests above.
