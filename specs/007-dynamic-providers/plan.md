# Implementation Plan: dynamic-providers

**Branch**: `007-dynamic-providers` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-dynamic-providers/spec.md`

## Summary

Replace the fixed list of five services by a catalogue of providers the user declares, and make routing, weekly history and the surplus runner follow it.

Approach (details and alternatives in [research.md](research.md)):

- **Catalogue**: one shared record per provider (`routing_config`, key `provider:{id}`), a tombstone on deletion, one `catalogue-order` record. Stable random ids (`p_…`, `q_…`) never equal to a former id. Local-first in `localStorage`, synced through a generic record-sync core extracted from the 006 surplus engine. No backend change; backups already copy every record.
- **Quota readings** keep the existing `quota_state` mechanism, now keyed by provider and quota id; data of the former fixed version is left untouched and never read.
- **Generic routing rules** in `src/routing/` replace `src/data/rules.js`: score = declared fit minus a pressure-band penalty; an explicit, total, order-independent tie-break (pressure bucket, sooner reset, pressure, fit, name, id) shared with surplus selection. Currency balances are normalised through a per-quota `lowBalance` that reproduces today's thresholds.
- **Existing pure code is reused** by mapping each provider to the runtime service shape it already reads (`toRuntimeService`): `evaluateSurplus`, cycle readings, snapshots and `getResetInfo` keep their logic and receive providers instead of `SERVICES`.
- **Weekly history**: additive v2 snapshots keyed by provider id; entries of removed providers are kept; old `services` sections are carried verbatim and shown as removed.
- **Surplus**: a per-provider profile (tool, weekly quota, session window) with explicit eligibility; policy v2 keyed by provider id; records keep their `serviceId` field name and gain a captured `providerName`.
- **Runner**: reads the catalogue from the store as untrusted data; authorisation comes only from a local allowance pinned to provider id **and** tool (`config.json` v2), plus the unchanged local idea approval; its stop watcher also stops a run when its provider is removed, switched off or re-tooled.
- **Constitution** Product Constraints amended (1.0.0 to 1.1.0) to replace the named canonical scope.

## Technical Context

**Language/Version**: JavaScript (ES Modules), Node.js 26 (`engines >=26`) for frontend build, backend and runner.

**Primary Dependencies**: React 18, React DOM 18, Vite 5. **No new runtime dependency**; the runner stays on Node built-ins.

**Storage**: `localStorage` (`kairos:providers` new; `kairos-ai-quota-router:state`, `kairos:weekly-history`, `kairos:surplus:*` extended); shared mode stores `routing_config` records (`provider:{id}`, `catalogue-order`) and existing `quota_state`/`snapshot` records in the existing SQLite `shared_records` table (no schema change); runner-local `~/.kairos-runner/config.json` v2.

**Testing**: `node:test` (`npm test` = frontend, backend, runner). Pure-logic tests with injected `now` and `newId`; scenario tests for routing (reference before/after, determinism under shuffling, 20 providers), weekly history across rename/edit/delete, surplus replay on user-declared providers, runner guardrails with the existing fake CLI and fake API, backend contract test for the new record keys.

**Target Platform**: Modern browsers (static frontend); optional LAN Node backend; optional local runner on macOS/Linux.

**Project Type**: Web application (static React frontend) with optional backend and optional local CLI.

**Performance Goals**: Recommendation and surplus evaluation synchronous on selection with 20 providers (≈ hundreds of operations); no pagination or memoisation needed (research D20).

**Constraints**: Offline-capable core; deterministic and order-independent rules; no provider named in code; stored v1 data never lost or rewritten (policy, snapshots, runs, cycles, runner config); one `now` for all day counts.

**Scale/Scope**: One user, up to ≥ 20 providers, ≤ 8 quotas each, 5 fixed tasks, 52 retained weeks.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design (see end of section).*

| Principle / constraint | Assessment |
| --- | --- |
| I. User-Value Routing First | Pass. Routing, history and surplus follow the user's real subscriptions; no feature outside routing value. |
| II. Deterministic Rules Before Complexity | Pass. Rules are explicit and versioned (`ROUTING_RULESET_VERSION`), tie-break is a total lexicographic key independent of creation/display order. No heuristic or model logic. |
| III. Verifiable Changes | Pass. Before/after reference scenarios with a documented intended-differences table; each FR group has failing-first tests (see quickstart and task phases). |
| IV. Explainable Recommendations | Pass. Every recommendation and every exclusion carries a reason from known inputs; surplus names its tie-break. |
| V. Minimal dependency, privacy by default | Pass. No new dependency. Definitions are local by default and travel only in shared mode, like quota state. Names, flags, notes and costs are never sent to an AI provider (runner sends only what 006 already discloses). |
| Product Constraints: canonical scope "Claude, ChatGPT, Copilot, pay-as-you-go APIs"; modes "mapped per service" | **Conflict, resolved by amendment**: this feature generalises the scope. Wording in research D19; constitution 1.0.0 → 1.1.0 (MINOR) in the same pull request. The three explicit input modes are unchanged. Tracked below. |
| Product Constraints: recommendations without network; static frontend deployable without backend | Pass. Catalogue works offline; only automatic runs need shared mode and the runner, as before. |
| Quality gates: Constitution alignment in spec/plan/tasks; docs updated with behaviour; before/after scenario for rule changes | Pass. Docs to update: `docs/agents/architecture.md`, `frontend.md`, `backend.md` (record keys), `docs/DEVELOPMENT.md`, `docs/SECURITY.md` (runner allowance), `runner/README.md`, `CHANGELOG.md` `[UNRELEASED]`, AGENTS.md. |

**Post-design re-check**: unchanged. The design adds no dependency, no backend surface, and keeps authorisation local. The one tracked exception is the constitution wording.

## Project Structure

### Documentation (this feature)

```text
specs/007-dynamic-providers/
├── plan.md              # This file
├── research.md          # Phase 0: decisions D1 to D20 and risks
├── data-model.md        # Phase 1: provider, tombstone, order, policy v2, snapshot v2, runner config v2
├── quickstart.md        # Phase 1: validation walkthrough
├── contracts/
│   ├── shared-records.md     # provider:{id}, catalogue-order, changed keys, trust rules
│   ├── routing-rules.md      # recommend() contract, rules, reference scenarios
│   └── runner-allowance.md   # config v2, allow/disallow, guard order, watcher change
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── data/
│   ├── tasks.js                  NEW  TASKS moved out of services.js (fixed task list)
│   ├── services.js               DELETED (fixed providers); former list moves to routing/fixtures (test only)
│   └── rules.js                  DELETED (replaced by src/routing/)
├── providers/                    NEW  pure, shared with runner
│   ├── ids.js                    newProviderId/newQuotaId (injected random), isProviderId, LEGACY ids
│   ├── schema.js                 constants (fit levels, quota types, schedules, limits), validateProvider, validateProviderRecord
│   ├── catalogue.js              reducers: add/update/remove/duplicate/reorder
│   ├── runtime.js                toRuntimeService(s), activeProviders, removedProviders
│   ├── commit.js                 commitCreation: quota-state patch first, definition second (atomic from the user's view)
│   ├── activeRun.js              activeRunFor, describeDeletion (delete/disable warnings)
│   ├── summary.js                summarizeProviders (per-currency cost totals, pressure count)
│   ├── engine.js                 createCatalogueEngine on src/sync/recordSync.js (shared mode, conflicts, nameConflicts)
│   ├── fixtures/                 test only: legacyData.js (stored v1 shapes), sampleProviders.js
│   ├── surplusProfile.js         SUPPORTED_TOOLS, surplusProblems
│   ├── tiebreak.js               normalizeName, compareByName
│   ├── records.js                logical keys, parse, applyCatalogueRecords, tombstone helpers
│   ├── storage.js                load/save kairos:providers (corrupt data loads empty)
│   ├── names.js + legacyProviders.js   display-name resolution (live, captured, tombstone, legacy table)
│   └── *.test.js
├── routing/                      NEW
│   ├── engine.js                 recommend(); pressure, score, order, reason
│   ├── constants.js              ROUTING_RULESET_VERSION, bands, buckets
│   ├── fixtures/                 legacyProviders.js, legacyRules.js (test only)
│   └── *.test.js                 engine, determinism, 20 providers, no-literal guard, reference before/after
├── sync/                         NEW  generic local-first record-sync core extracted from surplus/engine.js
├── surplus/                      CHANGED  constants (SUPPORTED_TOOLS), records/policy/ideas validators, evaluation tie-break and service filter, storage (policy v2), engine uses sync core, runs/cycles providerName
├── utils.js                      CHANGED  currency pressure via lowBalance; snapshots v2; provider series
├── stateTransitions.js           CHANGED  buildDefaultState returns {}, provider-aware snapshot/confirm
├── hooks/                        CHANGED  useQuotaState, useSharedQuotaState (no SERVICES seeding), NEW useCatalogue, NEW useNow (60 s tick so day counts follow local midnight), useSurplusStore takes providers
├── services/localExport.js       CHANGED  iterate catalogue, emit provider records
└── components/                   CHANGED  App, ServiceCard (provider card), RecoBox, SummaryBar, TaskPicker, SurplusNotice, SurplusSettings, CycleSummary, RunReview, WeeklyHistoryPanel
                                  NEW      ProviderManager, ProviderForm (+ QuotaFields, FitGrid, SurplusProfileFields), DeleteProviderDialog, EmptyState, each with a CSS Module
runner/
├── config.js                     CHANGED  schema v2, allowProviders, legacy passthrough
├── loop.js                       CHANGED  services from catalogue, guardService order, stop-watcher provider check
├── index.js                      CHANGED  allow / disallow / status
└── *.test.js                     CHANGED  guardrails, config, lifecycle
backend/
└── tests/contract/provider-records.contract.test.js   NEW  (no source change)
.specify/memory/constitution.md   CHANGED  1.1.0 amendment
docs/, runner/README.md, CHANGELOG.md, AGENTS.md          CHANGED
```

**Structure Decision**: Keep the existing three-deliverable layout (frontend, optional backend, optional runner). New pure modules go under `src/providers/` and `src/routing/` and, like `src/surplus/`, import nothing browser- or Node-specific so the runner can share them. No new package, no new top-level directory; the backend gets only a test.

## Phasing (input to /speckit-tasks)

0. **Constitution first**: the 1.1.0 amendment is the first behaviour-neutral change, so every later commit complies with the constraints in force.
1. **Foundations**: generic sync core extraction (behaviour-preserving); ids, schema, tie-break, catalogue reducers, records, storage; `tasks.js`.
2. **US1 and US3 (catalogue CRUD, local)**: reducers wired into hooks and UI (empty state, form, validation, edit, delete dialog); state without seeding.
3. **US2 (routing)**: generic engine, reasons, reference before/after, determinism, switch `RecoBox`/`SummaryBar` to providers; delete `rules.js` and `services.js`.
4. **US4 (shared, backup, export)**: catalogue sync, conflicts and tombstones, export records, backend contract test.
5. **US5 (history and surplus)**: snapshots v2 and series, policy v2, validators and names, evaluation filter and tie-break, surplus UI per provider, runner config v2, guard order, watcher, allow commands.
6. **US6**: duplicate and reorder.
7. **Closing**: constitution amendment, docs, CHANGELOG, AGENTS.md, no-literal guard, full verification (`quickstart.md`).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Constitution Product Constraints name a fixed provider scope | The feature's purpose is to remove that scope; user-declared providers cannot coexist with the old wording | Keeping the wording would make the feature non-compliant by definition; the amendment follows the Governance process (PR, impacted sections, version 1.1.0) |
| Extracting a generic sync core from the surplus engine | Catalogue needs dirty tracking, debounced flush, 409 resolution, full-pull deletion detection | A second hand-written engine duplicates subtle conflict code; extraction is behaviour-preserving and guarded by existing tests (risk R1) |
