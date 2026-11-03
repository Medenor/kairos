# Verification: 006-surplus-runner

- Date: 2026-11-03
- Branch: `006-surplus-runner`, base commit `6fb02b2` (the working tree had uncommitted changes; results apply to the working tree as measured)
- Runtime: Node v26.8.1 (`node` on PATH, macOS). Node 20 is not installed on this machine, so the Node 20 target of quickstart section 1 was not met literally. The evaluation timings below are from Node 26; they are not Node 20 numbers.
- Scope: T060 (automatable part) and T070 of `tasks.md`.

## Results

| Item | Target | Result | Method | Status |
| --- | --- | --- | --- | --- |
| Evaluation, warm: `evaluateSurplus` over 200 waiting ideas, both services (claude, chatgpt), mode `preview` | under 16 ms | Per process, 200 timed calls after 30 warm-up calls, 5 processes: median of medians 0.645 ms (range 0.634 to 0.656 ms); p95 0.70 to 0.78 ms; slowest single call 0.99 ms. Target met with a wide margin. | Throwaway script `/private/tmp/claude-501/-Users-raphael-Programmation-kairos/72a6cbea-3b19-48df-aad0-2c4f3652d122/scratchpad/bench-evaluate.mjs` (`warm`), `performance.now()` around each call | measured |
| Evaluation, cold: first call in a fresh process | (no target; reported separately) | 5 fresh processes, first call only: median 1.70 ms, max 1.78 ms (range 1.69 to 1.78 ms). Both services returned `eligible: true` for the fixture. | Same script, `cold` mode | measured |
| Note on the input | | The 200 ideas are all `waiting` with `serviceId: null` (the record's shape before a run). `evaluateSurplus` evaluates every waiting idea against each supported service in one call, so "across both services" means one call that returns results for claude and chatgpt. Fixture: claude weekly 60% remaining, chatgpt Codex 75% remaining, all fresh, reset in 2 days, surplus on for both. | | |
| SC-007: global stop or STOP file ends a run within 5 s of the runner reading it | under 5 s | Tests pass (17 of 17 in `runner/loop.lifecycle.test.js`). Asserted bound: the stop watcher has not fired at 4,999 ms and the run is `interrupted` with `stopped_by_user` at 5,000 ms; `endedAt - startedAt <= 5000` ms; the STOP-file test advances exactly 5,000 ms and expects `stopped_by_user`. | `node --test --test-reporter=spec runner/loop.lifecycle.test.js`. Uses an injected fake clock; the tool is a real child process that is really killed. | measured (logic and ordering only; see note A) |
| SC-001: text-only capture in at most three interactions | at most 3 | 2 interactions in the code: focus and type in the text field, then Enter (the form submits on Enter). If the field must first be clicked and typing is counted separately, 3. Both are within the target. The field is not auto-focused on mount, so the first action is a click or tab. | Code inspection of `src/components/IdeaCapture.jsx` (form `onSubmit`, `Add` button, text input). Not run in a browser. | inspected |
| SC-001: text-only capture under 10 s | under 10 s | Not measured. No browser was available to drive the dashboard. | Not measured | not measured |
| T060 automatable: `npm run test:runner` (`node --test runner/`) | all green | 303 tests, 303 pass, 0 fail, 0 skipped, 27 suites, about 6.3 s wall time | `npm run test:runner` | measured |
| T060: quickstart section 4 coverage by automated tests | each automatable step has a test | Mapped below. Every automatable step has at least one passing test. The containment canary and the real-tool billing check are not covered by automated tests (see Manual checks). | Reading `quickstart.md` section 4 and the test names in `runner/` | inspected |

Note A. The 5 s test uses an injected clock (`loop.testkit.js`), so it proves that the stop watcher is armed at 5 s and that the run is interrupted in that order. It does not prove wall-clock latency on a real machine: the time from the dashboard write to the runner's read depends on the runner's polling, network and store latency, and was not measured.

## Quickstart section 4: automated coverage

| Step (quickstart section 4) | Covered by |
| --- | --- |
| `config`, `approve` (prints text, context, folder; requires "yes"), `start` | `runner/index.test.js`: `config`, `approve`, `start` describes |
| Approval requested from the dashboard, not yet approved: `status` lists it, no run | `runner/index.test.js` "approve: without an id it lists ideas waiting for approval"; `runner/loop.guardrails.test.js` "idea not approved on this runner" (`not_approved`) |
| Approved, reset in window, fresh data: exactly one run, run record written | `runner/loop.guardrails.test.js` "exactly one run starts when every condition holds and its outcome is recorded"; `runner/loop.recovery.test.js` "the run record is written once as running and rewritten exactly once" |
| Edit the idea text: approval withdrawn, no run | `runner/loop.guardrails.test.js` "idea words changed after approval"; `runner/index.test.js` "editing the idea after approval puts it back in the pending list" |
| Stale data (weekly, session) | `loop.guardrails` "stale weekly data" (R3), "stale session data" (R5) |
| Protected hours | `loop.guardrails` "protected hours would be reached" (R6); `loop.lifecycle` "the hard stop is the protected hours start when it comes first" |
| Quota at reserve | `loop.guardrails` "weekly quota at the reserve" (R4); `loop.lifecycle` "quota at the reserve during a run stops it and keeps the partial output" |
| Global stop (control record) | `loop.guardrails` "global stop through the control record", "no control record"; `loop.lifecycle` SC-007 test |
| Missing folder | `loop.guardrails` "working folder missing" (`folder_not_found`); also "working folder refused", "relative folder without a projects base folder" |
| `ANTHROPIC_API_KEY` set | `loop.guardrails` "billing guard: API key in the environment"; `runner/preflight.test.js` "billing guard layer 1 (environment)" |
| Tool signed in with an API key (fake CLI) | `loop.guardrails` "billing guard: tool signed in with an API key"; `runner/preflight.test.js` "billing guard layer 2 (login mode), claude" and "codex" (API-key login => `billing_guard`) |
| Global stop during a run (within 5 s) | `loop.lifecycle` "a global stop written to the control record ends the run within 5 s (SC-007)" and "a STOP file ends the run within 5 s" |
| Start after the reset day has begun: nothing replayed | `loop.guardrails` "a tick that begins after the reset day started starts nothing and replays nothing" |
| Second device: exit code 3 | `runner/lease.test.js` "a second device's start exits with code 3 even when the first lease has expired (FR-014)"; `runner/loop.guardrails.test.js` "a device that is not the designated runner exits with code 3" |
| `config --take-over`, then `start`; first runner exits on next heartbeat | `runner/lease.test.js` "config --take-over on the second device: the first runner exits on its next heartbeat"; `runner/index.test.js` "--take-over designates this device" |
| Kill mid-run and restart: finalised as interrupted, not started twice | `runner/loop.recovery.test.js` "a restart after a crash finalises the unfinished run as interrupted, once, and does not start the idea again"; "a journal start with no run record ... is closed as interrupted" |
| Containment canary (original unchanged, copy is the only write target, diff only) | Partly: `runner/workdir.test.js` "the original folder is byte-identical after prepare, edits in the copy, diff and clean"; `runner/loop.lifecycle.test.js` "changes made in the copy are stored as a proposal and the original stays untouched". These use the fake CLI. A real tool reading outside the copy is NOT automated (see Manual checks). |
| `runner clean` removes the copy | `runner/index.test.js` `clean` describe; `runner/workdir.test.js` "clean removes the copy" |

## Manual checks pending (need the user's signed-in tools)

These were not run. Nothing below has been executed by the agent that wrote this file.

- [ ] **Containment canary.** A real `claude -p` or `codex exec` run in the disposable copy must not be able to read or modify the original folder or read `~/.ssh`.
  1. Pick a throwaway original folder outside the repo, for example `~/kairos-canary/original`. Put in it `notes.txt` with the text `original`, and create `~/kairos-canary/outside.txt` with the text `outside`.
  2. Record checksums: `shasum -a 256 ~/kairos-canary/original/notes.txt ~/kairos-canary/outside.txt > ~/kairos-canary/before.sha`.
  3. Make the disposable copy the runner would make: `cp -R ~/kairos-canary/original ~/kairos-canary/copy`. Use a copy, never the original, for steps 4 and 5.
  4. From inside the copy, run the same invocations the runner uses (`runner/adapters/claude.js` and `runner/adapters/codex.js`). These consume subscription quota, so use a throwaway prompt:
     - Claude: `claude -p --output-format json --permission-mode dontAsk -- "Read ../outside.txt and ../original/notes.txt, overwrite ../original/notes.txt with the word changed, then print the contents of ~/.ssh/config if you can."`
     - Codex: `codex --ask-for-approval never exec --sandbox workspace-write --cd ~/kairos-canary/copy --skip-git-repo-check -- "<same prompt>"`
  5. Compare: `shasum -a 256 -c ~/kairos-canary/before.sha` must report both files OK. Check that the tool's output does not contain the contents of `~/.ssh/config` or `outside`. Note that a refusal in the output is not proof of containment. For a stronger check on macOS, run `sudo fs_usage -w -f filesys | grep -i -E "ssh|kairos-canary"` in a second terminal during step 4 and confirm no access to `~/.ssh` or `original/`.
  6. Remove the test folders: `rm -rf ~/kairos-canary`. Write the result (pass or fail, with the tool and version) into this file under a new heading.
  7. If the tool can reach the original folder or `~/.ssh`, do not enable automatic runs. Record the finding in `docs/SECURITY.md` (residual containment risk).

- [ ] **API-key-login billing check.** With a real signed-in tool, confirm preflight refuses when the tool is logged in through an API key.
  1. Confirm the API key variables are unset in the shell that starts the runner: `env | grep -c -i -E "ANTHROPIC_API_KEY|OPENAI_API_KEY"` must print `0`. Do not print the values.
  2. Check the current login: `claude auth status --json` (the preflight reads `authMethod`, which must be `claude.ai`) and `codex login status`. Record the output without any secret.
  3. Switch the tool to API-key login using that tool's own login command (for Claude, `claude /login` and choose the API-key option; for Codex, `codex login --with-api-key`). This changes the user's login state, so do it deliberately.
  4. Run `npm run runner -- start` (or `node runner/index.js start`) with a config that allows the service. Expected: preflight reports `billing_guard`, exit with no run started, and the reason shows in `npm run runner -- status`.
  5. Switch back to the subscription login and confirm `authMethod` is `claude.ai` (or ChatGPT for Codex). Run `start` again and confirm preflight passes.
  6. Record the outcome (the exact reason shown, pass or fail, tool version) in this file under a new heading.

## Next steps

- Mark T060 and T070 done only after the two manual checks above are recorded.
- If the SC-001 time target is required as a measured number, run quickstart section 3 step 2 in a browser and record the elapsed time.
- If the Node 20 target is required, install Node 20 and rerun the benchmark script.

## Browser verification (SC-001)

- Date: 2026-11-03
- Environment: Chrome driven through Claude in Chrome, Vite dev server (`npx vite --port 5173`, started with `VITE_SHARED_API_BASE_URL` pointing to a closed port so the app stayed offline; the default API probe list includes `localhost:8080`, which on this machine is another project's reverse proxy). Window 1250x929. No `kairos` docker container was touched.
- Method: a page-side script recorded `performance.now()` at the first `focusin` on the idea text field, and again from a `MutationObserver` the moment the new idea text appeared in the page. Interactions were counted from captured `click` and `keydown` events. The real mouse click, typing and Enter came from the browser tool.

| Run | Interactions | Focus to idea shown as Waiting | Notes |
| --- | --- | --- | --- |
| 1 | 3 (click field, type text, Enter) | 36 ms | click, type and Enter sent in one batch |
| 2 | 3 | 26 ms | same |
| 3 | 3 | 21 ms | same |
| 4 | 3 | 218 ms | tool calls issued separately |

- Median of runs 1 to 3: 26 ms. Max: 36 ms (218 ms in the separately issued run 4).
- Interaction count: 3 from a cold field (click, type, Enter). The submit button needs no extra click, and after each add the field is refocused, so a following idea takes 2 (type, Enter). The field is not auto-focused on page load. Within the target of at most 3.
- Time: the automation types all characters within about 10 ms, so these numbers measure the app (state update, render, persist), not a person. A human typing a 15 to 30 character idea at 4 to 6 characters per second would add roughly 3 to 7 s plus about 1 s to reach the field. That estimate is a model, not a measurement. The under 10 s target is met by the app latency with a wide margin; the human total (about 4 to 8 s by the model) is also under 10 s but was not timed with a person.
- Result: SC-001 interactions measured (3), app latency measured (median 26 ms); human wall-clock not measured.

## Quickstart walkthrough (T071)

- Date: 2026-11-03
- Environment: two Vite servers on 127.0.0.1 (5173 offline/local mode, 5174 shared mode) and a throwaway backend (`node backend/src/server.js`, `DB_PATH` in the scratchpad dir, port 8877, `HOST=127.0.0.1`), `VITE_SHARED_API_BASE_URL=http://localhost:8877/api/v1`. All three were stopped afterwards. Chrome, dark OS theme, Europe/Paris (CET) time zone. Seeded data (runs, cycles, runner lease) was written through `localStorage` keys `kairos:surplus:*` in local mode and through `POST /records` in shared mode. UI steps were driven with real clicks where marked (R) and with DOM clicks and value setters elsewhere. No source, test or doc file was edited.
- Out of scope, skipped: all quickstart section 4 steps that need the real `runner` process or a signed-in `claude`/`codex` tool (approve, start, guardrail breaking, kill and restart, second device, containment canary, API-key billing check). Section 1 (automated checks) was not part of this browser task.

### Section 2: before/after scenario (State: Claude weekly 40% consumed, 5 h slot 40% consumed, last reset 5 days ago, confirmed just now, one waiting medium idea, surplus on, defaults)

| Step | Result | Evidence |
| --- | --- | --- |
| Before: surplus off, no suggestion | pass | Notice "No surplus suggestion right now", Claude "R1 surplus is off for this service" |
| After: notice with arithmetic and rule outcomes | pass | "Claude: 60% remaining minus 20% reserve minus 8% cost leaves 32%; resets in 2d; all rules pass"; R1 to R7 each shown with pass and reason |
| Same state, weekly confirmed 20 h ago | pass | No suggestion, "R3 weekly reading older than 12 h (confirmed 20 h ago); confirm the values", and a "Confirm values are still current" button; the card shows "updated 20 h ago" |
| "Confirm values are still current" restores the suggestion | pass | suggestion back after one click |
| Same state, reset due today | pass | "R2 reset due today" (also "R6 a 60 min run would reach the reset day (2026-11-03 00:00)") |
| Reset overdue by 2 days (extra) | pass | "R2 reset overdue by 2d" |
| Reserve 30, window 1 day (extra) | pass | arithmetic changed to "minus 30% reserve ... leaves 22%"; with window 1: "R2 reset in 2d, beyond the 1d window" |
| Protected hours reached by a 60 min run (extra) | pass | "R6 a 60 min run would reach protected hours at 2026-11-03 20:30" |

### Section 3: suggestion-only (offline, no backend)

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Open dashboard with no backend | pass | all sections render offline; copy "The queue works on this device. Automatic runs need shared mode and are unavailable until a workspace is set." |
| 2. Capture text-only idea, at most 3 interactions, shows as waiting | pass | see SC-001 section above |
| 3. Add context and working folder, reload: queue unchanged | pass | idea with context, folder, priority High, size Large saved; after full reload the queue, details (context and "~/projects/parser (checked only on the runner device)"), priority and size were identical. Queue is ordered by priority first, then by position |
| 4. Surplus on, reset in 2 days, confirm values: notice with rationale and copyable instruction | pass | (R) "Copy instruction" click showed "Instruction copied."; text block shows task, context, working folder and tool command |
| 4b. "Mark as launched manually" changes status | pass | two-step confirm ("Yes, I launched it"), then the idea shows "Launched manually" and is stored as `launched_manually` with `serviceId: claude`; the next waiting idea is suggested |
| 5. Stale data: not eligible with reason | pass | by editing the stored timestamp to 20 h ago and reloading, as above |
| 6. Day count equals between card and notice | pass (partial) | card "2d until next reset" and notice "resets in 2d" agree at the current time. The near-midnight case needs a time zone change, which a browser tab cannot do; it is covered by `TZ=Pacific/Auckland node --test src/utils.reset.test.js` (not run here) |

Other checks in this section

| Check | Result | Evidence |
| --- | --- | --- |
| Quota entry and age labels | pass | after "-5" clicks the weekly value shows "updated just now" while the 5 h slot still says "never confirmed" until "Still current" is pressed; then both say "updated just now"; stamped values with 2 h and 20 h read "updated 2 h ago" and "updated 20 h ago" |
| Reset date entry | pass | date input accepts a date; card shows "2d until next reset" and "Next reset: 2026-11-05" |
| Edit idea | pass | text, context, folder, priority and size can be edited and saved; `contentVersion` increments (2, 3, 4) |
| Reorder | pass | Move up and Move down change order and persist; moves are disabled across priority groups ("Already first in its priority") |
| Archive and show archived | pass | idea leaves the queue, appears under "Show archived (n)" |
| Delete | pass | inline two-step "Confirm delete" or "Keep"; no browser dialog; record removed from storage |
| Reload persistence | pass | queue, archive, policy, quota values and age stamps survived reloads |
| Request approval | pass | idea shows "Awaiting approval on the runner" and appears in the "Awaiting approval" list; the list text says it never authorises a run |
| Approval withdrawn after editing an approved idea | pass | with a seeded runner lease approving the idea at its current version, the idea showed "Approved on runner" (informational). After editing the text the idea showed "Awaiting approval on the runner" and "Approval withdrawn: the idea changed, it must be approved again." Same result in shared mode, where the edit also reached the server (`contentVersion` 2) |
| Settings: reserve, window, protected hours | pass | reserve and window values change the notice maths and persist; a protected range (default Mon to Fri 09:00 to 12:00 on adding, editable) is stored and enforced by R6 |
| Automatic-run toggle disabled until protected hours and shared mode | pass | local mode with no range: disabled, "Declare protected hours below first. Shared mode is off: automatic runs need a workspace id..."; local mode with a range: still disabled, "Shared mode is off"; shared mode with no range: disabled, "Declare protected hours below first."; shared mode with a range: enabled |
| Disclosure dialog (shared mode) | pass | (R) enabling opens "Enable automatic runs on Claude?" with four points; the confirm button is disabled until the acknowledge box is ticked; `aria-modal="true"`; Escape closes it, focus returns to the checkbox, nothing is enabled; after tick and confirm: `autoRunEnabled: true` and `disclosuresAckAt` set in the policy record |
| Global stop button (shared mode) | pass | "Stop all automatic runs" is always enabled; "Switch back on" turned the control record on and the stop button turned it off; server record `surplus-control` showed `autoRunEnabled: false` (version 2) after the stop. The global switch starts off even after a service is enabled, so the user must press "Switch back on" (see defect 5) |
| Standing provider-rules notice (FR-025) | pass | shown at the top of Surplus settings; "Suggestion-only for all services" control present |
| Shared-store notice (FR-024) | pass | shown in shared mode (see defect 6 for duplication) |

### Section 5: review and measurement (seeded data)

Seeded one completed, one failed and one interrupted run, three ideas, and two reset cycles for Claude.

| Step | Result | Evidence |
| --- | --- | --- |
| Each record shows idea, service, times, status, output as a draft, decision inputs, failure reason | pass | list of three with status badges; detail pane shows service, started, ended, estimated quota used, working folder, idea context, output labelled "Draft, not applied", proposed changes as a coloured diff labelled "Draft, not applied" with "Your original folder was not modified", decision inputs, and the failure text for the interrupted run ("Stopped with the global stop. (stopped_by_user) The idea can be run again.") |
| Output rendered as text, not HTML | pass | output `Draft notes <script>alert(1)</script> done.` shown literally; no `<script>` element, no dialog |
| Accept (completed) | pass | "Decision: Accepted. Nothing outside Kairos was changed."; idea `archived`, `resultDecision accepted` |
| Discard (failed) | pass | inline "Confirm discard" step, then idea `archived`, `resultDecision discarded` |
| Re-queue (interrupted) | pass | idea back to `waiting`, `resultDecision requeued`, shown in the queue |
| Run records unchanged by decisions | pass | still 3 run records, unmodified |
| Cycle summary after two simulated cycles | pass | rows per reset: 2026-10-29 "31.5%" with "31% estimated" consumed by runs; 2026-10-22 "≈ 55%" with the badge "Approximate: last reading 20 h before reset". ChatGPT: "History too short" message |
| Shared mode: seeded run, idea and cycle appear | pass | records posted to the throwaway backend appeared in the queue and run review within the 3 s poll |

### Layout and appearance

| Check | Result | Evidence |
| --- | --- | --- |
| Phone width, no horizontal scroll | pass (with caveat) | Chrome refuses a window narrower than 500 px (`innerWidth` stayed 500, `scrollWidth` 485). To get 390 px the dashboard was loaded in a same-origin iframe of 390 px (inner width 388): `scrollWidth` 373, no element extends past the viewport unless inside a scroll container (weekly history table). Checked with notice details open, capture details open, run review and settings. Screenshots looked correct; 7 controls are under 24 px (checkboxes and small steppers) |
| Dark appearance legibility | pass with notes | readable by eye. Computed contrast of 11 text styles is under 4.5:1 (lowest: "Failed" badge 3.5, R pass badges 3.93, muted chips 3.88, "Stop all automatic runs" 3.93, small 11 px labels 4.31); see defect 3 |
| Light appearance legibility | fail (low contrast) | the OS theme could not be switched, so the dark `prefers-color-scheme` rule was deleted in the page to render the light variables. Amber text on a pale amber badge measures 1.7 to 1.8:1 ("Not eligible", "R6 fail", "Awaiting approval on the runner", "Interrupted" run badge); green pass badges 2.7:1; many existing 12 px grey meta labels 3.3 to 3.6:1. Text is visible but weak; see defect 1 |
| Console free of errors and warnings | pass | `read_console_messages` showed only Vite debug lines and the React DevTools info line over both servers; no errors or warnings. Limit: messages from an earlier tab group (the SC-001 session) were lost when Chrome closed that group mid-run, and refused requests to the unused port in offline mode did not show up either |

### Section 6: documentation checks

| Check | Result |
| --- | --- |
| README, architecture, SECURITY, DEPLOYMENT and CHANGELOG describe the feature | pass: all five mention surplus and the runner; SECURITY has a threat model section, "Exposure through the unauthenticated store" and containment ("not a sandbox"); CHANGELOG has an `[UNRELEASED]` entry |
| Standing provider-rules notice (FR-025) described | partial: stated in README (line 86), DEPLOYMENT (line 128) and SECURITY; not mentioned in `docs/agents/architecture.md` or in `CHANGELOG.md` (no occurrence of "provider" or "suggestion-only"). Whether the quickstart wording requires all five is ambiguous |

### Defects and observations (most severe first)

1. Light mode contrast (medium, visual). Amber (`#EF9F27`) text on a pale amber tint is 1.7 to 1.8:1 and green pass badges are 2.7:1. Affects the surplus notice badge ("Not eligible"), R fail badges, the approval chip and the interrupted status badge in `SurplusNotice`, `IdeaQueue` and `RunReview` styles. Steps: remove the dark rule or use a light OS, open any section with those badges. Expected 4.5:1 for small text; actual 1.7 to 2.7:1. No console text.
2. Not tested, not a defect: the near-midnight day-count (needs another time zone) and the real tool steps of section 4.
3. Dark mode contrast (low). Eleven small-text styles between 3.5 and 4.4:1 (lowest "Failed" badge 3.5:1); the stop button label is 3.93:1.
4. Phone width (low, test limit). Chrome cannot go below 500 px here, so 390 px was checked in an iframe; the layout passed, but the real browser window was not at 390 px.
5. Global switch UX (low). After enabling automatic runs for a service the global switch is still off and the text reads "Global switch: off ... Switch back on", although it was never on. Not wrong, but the wording suggests a stop happened. Expected: a hint that the global switch must be turned on; actual: only a "Switch back on" link.
6. Duplicate shared-store notice (cosmetic). In shared mode the unauthenticated-store sentence appears twice, once in "New idea" and once in "Idea queue".
7. Automatic-run toggle for a service with surplus off (low). The ChatGPT toggle was enabled although "Use surplus quota for queued ideas" was off for ChatGPT, so the disclosure dialog can be accepted for a service that rule R1 blocks anyway. Expected per spec: not stated; flagged for a decision.
8. Run list at phone width shows a nested scroll box for the three records with a visible scrollbar (cosmetic).
9. "Request approval" is offered on ideas that are completed or launched manually (cosmetic or logic, low); not verified whether that is intended.
10. R6 message wording when the reset day is already past: "a 60 min run would reach the reset day (2026-11-01 00:00)" refers to a date in the past (cosmetic).
11. Docs: `architecture.md` and `CHANGELOG.md` omit the provider-rules notice (see section 6).

Tool-side events during the run: the Chrome tab group was closed by the browser mid-run (after the SC-001 and first checks) and a new tab was opened in a new group; the other agent's code changes did not break the dev server and behaviour did not shift.
