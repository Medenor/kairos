# Quickstart: validating surplus-runner

Prerequisites: Node 20, `npm ci`, `sqlite3` on `PATH` for backend tests. Commands and data shapes are defined in [contracts/](contracts/) and [data-model.md](data-model.md); this guide only says what to run and what to expect.

## 1. Automated checks

```bash
npm run lint && npm test && npm run build
node --test src/surplus/                 # rules, selection, time, ideas, instruction, cycles
node --test runner/                      # fake CLI + fake API: guardrails, idempotence, stop
TZ=Pacific/Auckland node --test src/utils.reset.test.js   # day count near local midnight
```

Expected: all green; the surplus suite contains one passing and one failing case per rule R1 to R7.

## 2. Before/after scenario (constitution III)

State: Claude weekly 40% consumed (60% remaining), 5 h slot 40% consumed, last reset 5 days ago (reset in 2 days), values confirmed 2 hours ago, one waiting medium idea approved on the runner, surplus on, defaults.

| When | Expected |
| --- | --- |
| Before the feature | No suggestion exists |
| After | Notice for Claude: 60% remaining minus 20% reserve minus 8% cost, idea suggested with each rule outcome |
| Same state, confirmed 20 h ago | No suggestion; reason "weekly reading older than 12 h"; prompt to confirm |
| Same state, reset due today | No suggestion; reason "reset due today" |

## 3. Manual: suggestion-only (User Stories 1, 2, no runner)

1. `npm run dev`, open the dashboard with no backend (offline).
2. Capture an idea with text only: under 10 s, at most three interactions; it shows as waiting.
3. Add context and a working folder, reload: the queue is unchanged.
4. Set Claude surplus on, reset in 2 days, confirm values: the notice appears with the rationale and a copyable instruction; choose "launched manually" and see the status change.
5. Make data stale (change the confirmed time or wait): the service becomes not eligible with the reason shown.
6. Near local midnight (or by running the `TZ` test above): the day count on the card equals the day count in the notice.

## 4. Manual: shared mode and runner (User Story 3)

```bash
npm run docker:run:shared          # or: npm run backend:start (needs sqlite3)
npm run runner -- config           # device id, API base, workspace, projects base folder
npm run runner -- approve          # prints exact text, context, folder; type "yes"
npm run runner -- start
```

Checks, each with its expected outcome:

| Step | Expected |
| --- | --- |
| Request approval from the dashboard on another device, do not run `approve` | `status` lists it as awaiting approval; no run starts |
| Approve, place the reset inside the window, fresh data | Exactly one run starts; idea becomes running; run record written |
| Edit the idea text on the dashboard | Approval withdrawn, UI says re-approval is needed; no run starts |
| Break each guardrail in turn: stale data, protected hours, quota at reserve, global stop, missing folder, `ANTHROPIC_API_KEY` set | No run starts; reason shown in `status` and recorded |
| Press the global stop in the dashboard during a run | Process ends within 5 s of the runner reading the control record (5 s stop watcher); idea returns to a retriable state; no new run until re-enabled |
| Start the runner after the reset day has begun | No run starts for that service; reason "reset due today" or "overdue"; nothing is replayed |
| Sign the tool in with an API key instead of the subscription | Preflight fails with `billing_guard`; no run starts |
| Start a runner on a second device | Exits with code 3 (another device is designated), even after the first runner stopped and its lease expired |
| Run `config --take-over` on the second device, then `start` | The second device becomes the designated runner; the first one exits on its next heartbeat |
| Kill the runner mid-run and restart | Run finalised as interrupted; idea retriable; not started twice |

Containment canary (manual, documented residual-risk check): approve an idea that asks the tool to modify a file in the original folder and to read a file outside the copy. Expected for Claude: the original is unchanged (compare checksums), the file outside is not read or modified (contained), and the proposal appears only as a diff in the run record. Expected for Codex: the original is unchanged and writes outside the copy are blocked, but reads outside the copy are not contained (the file outside can be read and printed). Codex ideas are skipped with `codex_reads_uncontained` unless `"allowCodexAuto": true` is set in `~/.kairos-runner/config.json` (default `false`), so run the Codex canary only after opting in (FR-017). `runner clean` removes the copy.

## 5. Review and measurement (User Story 4)

Produce one completed, one failed (stop it) and one interrupted run. In the dashboard open each record: idea, service, times, status, output as a draft, decision inputs, failure reason. Accept, discard and re-queue one each and confirm nothing outside Kairos changes. After two simulated reset cycles the per-cycle summary shows quota left at reset and the part consumed by runs, with the approximate marker where the last reading was older than 12 h at reset.

## 6. Documentation checks

README, `docs/agents/architecture.md`, `docs/SECURITY.md` (runner threat model, unauthenticated store, residual containment risk), `docs/DEPLOYMENT.md` and `CHANGELOG.md [UNRELEASED]` describe the feature and the standing provider-rules notice (FR-025).
