# Verification: dynamic-providers

Branch `007-dynamic-providers`. State at the end of implementation: `npm run lint` 0 errors (3 warnings in `useSharedQuotaState.js`, present before this feature), `npm run build` green, `npm test` green (frontend 653, backend 25, runner 380; none skipped).

## Verified in a real browser (2026-11-05, Chrome, Claude in Chrome, dev server on 5173)

Single-profile local walkthrough, observed:
- Empty state "No provider yet" with "Add your first provider"; previous-version weekly history (five legacy providers) listed read-only.
- Add provider (name, one weekly consumed-% quota at 30%, heavy-coding fit Strong): card appears, recommendation names it with "Only provider currently available for this task".
- Duplicate creates "Walkthrough Provider (copy)" and opens its edit form; Cancel closes it.
- Delete dialog lists what is removed (quota, reset date) and kept (history marked as removed, past records). After deleting both, the list returns to the empty state and the history picker shows both as "(removed)".
- The browser profile had shared mode on with earlier runner test data; a past run showed its provider as "Claude (removed)".

## Still NOT verified in a real browser

The Chrome extension was not connected during implementation, so the manual walkthroughs of `quickstart.md` (tasks T059, T069, T080, T111, T116) were **not run** in a browser. Substituted evidence: reducer and engine tests, and `src/providers.ui.integration.test.js`, which renders the real components (`ProviderManager`, `ProviderForm`, `DeleteProviderDialog`, `RecoBox`, `EmptyState`) to static markup for each state of the walkthrough. Typing, clicking, two browser profiles, leaving the page open across midnight and a real runner against a real `claude`/`codex` are still to be done by hand before merge. Pull request (T123) not opened.

## Intended differences from the former rules (`routing.reference.test.js`)

Grid: 19 440 scenarios (6 Claude weekly × 2 slots × 3 Copilot × 3 ChatGPT × 3 Kilocode × 2 OpenRouter × 6 reset states × 5 tasks); the generic engine agrees with the former table on 68 % and every divergence is one of the 13 rows below (a surprise or a stale row fails the test).

| Task | Former pick → generic pick | Cause |
| --- | --- | --- |
| coding_hard | ChatGPT → Claude, ChatGPT → Copilot, Claude → ChatGPT, Copilot → ChatGPT, Copilot → Claude | Generic score (fit minus pressure band) and fixed 15-point pressure buckets replace the per-provider thresholds (D5, D7) |
| coding_light | ChatGPT → Claude, ChatGPT → Copilot, Claude → ChatGPT, Claude → Copilot | Same |
| work_heavy | Claude → ChatGPT | Same; the "work tasks justify the quota spend" override is dropped (D8) |
| daily_chat | Claude → ChatGPT | The daily_chat redirect and its 40 % threshold are dropped; declared fit decides (D8) |
| oneshot | Copilot → Kilocode | USD > 1 cut-off and named fallback dropped; a declared balance above zero stays eligible (D8) |
| oneshot | Kilocode → OpenRouter | Pressure bands from the per-quota low-balance level (D5, D6) |

## Functional requirements

| FR | Evidence |
| --- | --- |
| FR-001 | `storage.test.js` (empty/corrupt/legacy load gives no provider), `stateTransitions.quota-stamps.test.js` (`buildDefaultState()` is `{}`), UI test "no provider" |
| FR-002 | `schema.test.js` (name rules, uniqueness after NFC/trim/case fold), `catalogue.add.refusals.test.js`, `engine.late.test.js` (duplicate names after sync kept and listed by `nameConflicts`) |
| FR-003 | `catalogue.update.test.js`, `engine.test.js`; edit form in UI test |
| FR-004 | `catalogue.remove.test.js`, `activeRun.test.js`, `DeleteProviderDialog` UI test |
| FR-005, FR-006, FR-007 | `schema.test.js` (quota limits and values), `catalogue.add.refusals.test.js`, `catalogue.update.test.js` (type change without value refused) |
| FR-008 | `utils.reco-reset.test.js` (weekly, 30-day, custom 10-day, none: countdown, due, overdue) |
| FR-009, SC-009 | `engine.scale.test.js` (20 providers × 8 quotas under 200 ms, equal under shuffling), `engine.determinism.test.js` (20 providers) |
| FR-010 | `catalogue.duplicate.test.js`, `catalogue.reorder.test.js`, `engine.test.js` (single `catalogue-order` write) |
| FR-011 | `no-provider-literals.test.js` (shipped sources name no provider; allow-list limited to tool names and the legacy table) |
| FR-012, FR-013 | `engine.test.js` (routing): fits, gating, bands, three quota types, `utils.currency.test.js` |
| FR-014, SC-004 | `engine.determinism.test.js` (200 permutations), `catalogue.reorder.test.js`, `evaluation.providers.test.js` (both input orders) |
| FR-015 | `engine.reset.test.js` |
| FR-016 | `engine.test.js`, `engine.nopick.test.js` (reasons, alternatives, excluded causes, three empty messages) |
| FR-017 | `engine.determinism.test.js` (removing the primary) |
| FR-018 | `src/data/tasks.js` unchanged task list |
| FR-019 | `engine.test.js`, `engine.tombstone.test.js`, `engine.late.test.js`, `recordSync.test.js`, `provider-records.contract.test.js` |
| FR-020 | `us3-backup-restore.test.js` (provider case), `localExport.providers.test.js` |
| FR-021 | `catalogue.persistence.test.js` (state first, definition second; failing storage), refusal tests return the same references |
| FR-022 | `legacyData.js` fixtures in `catalogue.add.test.js`, `localExport.stamps.test.js`, `stateTransitions.quota-stamps.test.js`, `storage.providers.test.js`, `config.providers.test.js` |
| FR-023 | `ids.test.js`, `catalogue.remove.test.js` (recreated provider inherits nothing) |
| FR-024 | `runtime.test.js`, `surplusProfile.test.js` |
| FR-025 | `engine.test.js` ("local actions never need the network") |
| FR-026 to FR-030 | `utils.weekly-history.providers.test.js`, `utils.history-series.test.js`, `engine.late.test.js` |
| FR-031, FR-032, FR-034 | `surplusProfile.test.js`, `evaluation.providers.test.js` (006 scenario replay, tie-break by name), existing evaluation suites |
| FR-033 | `policy.providers.test.js`, `policy.test.js` |
| FR-035, SC-011 | `loop.guardrails.providers.test.js` (store-written provider, flipped policy, tool switch, tombstone, guard order, `providerName`), `config.providers.test.js`, `index.providers.test.js` |
| FR-036, SC-012 | `records.providers.test.js`, `storage.providers.test.js`, `RunReview` / `CycleSummary` resolve names through `resolveProviderName` |
| FR-037 | `loop.lifecycle.providers.test.js` (removed, surplus off, auto off, tool change, ineligible; unrelated edit does not stop), form and settings warnings in the UI |
| FR-038 | `day-basis.test.js`, `recommendation-vs-surplus.test.js` (three zones, 23:59 and 00:01) |
| FR-039 | `catalogue.add.test.js` (value and stamp written at creation), `providerDraft.test.js` (untouched quota sends no value) |

## Success criteria

SC-001, SC-002, SC-013 are time-on-task criteria and need a person at the keyboard (not measured). SC-003 and SC-006: reducers return the new catalogue immediately and refusals return the same references. SC-005: reference grid above. SC-007: `engine.test.js` conflict tests. SC-008: restore test. SC-010: history series tests.
