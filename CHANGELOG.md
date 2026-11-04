# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [UNRELEASED]

### Added

- Idea queue (`specs/006-surplus-runner`): capture ideas with text, optional context, working folder, priority, size and archive/delete. Ideas sync in shared mode.
- Expiring-surplus suggestions: for a service enabled for surplus use, shows the quota expected to expire at reset, the best-fitting waiting idea, a copyable instruction and the rule outcomes behind it. Services with stale data, unknown reset dates or no waiting idea are reported with the reason.
- Quota reading age and "still current" confirmation: a reading older than 12 h makes its service ineligible until the user updates or confirms it.
- Reset-cycle history: per reset cycle, the quota left at reset and the part consumed by runs. Cycles whose last reading was old at reset are marked approximate.
- Standing notice that provider rules on automated usage of subscriptions can change; automatic runs stay off by default and can be switched back to suggestion-only at any time.
- Optional local runner CLI (`runner/`, `npm run runner`, Node built-ins only), for shared mode only. Runs are off by default per service, require approval on the runner device, and can be stopped globally. Claude runs are scoped to a disposable copy of the working folder; Codex writes are confined to the copy but its reads are not, so Codex ideas are skipped in the automatic loop unless `allowCodexAuto` is set (see `docs/SECURITY.md`).
- Runner: an idea without a working folder can now be approved and run, limited to drafts that need no project files. It runs in an empty scratch directory (nothing copied from the user's disk), is approved with `resolvedFolder` null in the approval hash, and its created files appear as added files in the proposal.
- Run review: each run record shows the idea, service, times, status, output as a draft, decision inputs and failure reason, with accept, discard and re-queue actions.
- Weekly history (`specs/005-weekly-history`): one quota snapshot per workspace and local calendar week, recorded locally on load and on every change (works offline), updated in place within the week, 52 completed weeks retained.
- Weekly history panel with per-service week-by-week comparison, explicit `Missing week` / `Missing service` gaps, short-history messaging, and archived-service support.
- Weekly snapshots sync through existing shared `snapshot` records (`weekly-history:{weekKey}`), are included in localStorage migration (re-scoped to the target workspace), and never alter live quota values. Only the current week is pushed to the server.
- `npm run test:frontend`; `npm test` now runs frontend and backend suites.
- Shared-state backend (`backend/`) with LAN-restricted API (`/api/v1`) and SQLite persistence. Login endpoints exist but data routes do not enforce authentication yet (see `docs/SECURITY.md`).
- Optimistic-concurrency shared record sync endpoints plus conflict (`409`) responses.
- LocalStorage migration API with idempotency-key support and migration job status tracking.
- Backup create/list/restore API and frontend operator panel for recovery drills.
- Frontend shared-state integration (`useSharedQuotaState`) with sync status/conflict UI.
- Backend contract and integration tests for US1/US2/US3 plus quickstart e2e regression test.
- Shared stack runtime wiring: `docker/docker-compose.shared.yml` and `scripts/docker/run-shared.sh`.
- Dockerized delivery with multi-stage `Dockerfile` (Node build stage + Nginx runtime stage).
- Nginx runtime config with SPA routing and readiness endpoint at `/healthz`.
- OCI image labels and immutable-tag build script (`scripts/docker/build-image.sh`).
- Local deployment, self-hosted deployment, and verification scripts under `scripts/docker/`.
- Integration verification scripts for US1/US2/US3 under `tests/integration/docker/`.
- Environment profile samples for `dev`, `staging`, and `prod` in `docker/env/`.
- Container runtime contract schema, quickstart deployment matrix, and verification evidence artifacts.

- Developer documentation: `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/CONTRIBUTING.md` and per-topic agent guides in `docs/agents/`.
- ESLint (flat config) for frontend and backend; `npm run lint` and `npm run lint:fix` now run real checks.
- `.editorconfig`, `.nvmrc` (Node 20) and `engines` constraint.

### Changed

- Node baseline raised from 20 (end of life) to 26 LTS: `.nvmrc`, `engines`, the `Dockerfile` and `docker/docker-compose.shared.yml` images (`node:26-alpine`). Node 22 and later also run the backend test glob that Node 20 could not.
- Forgejo CI and issue/PR templates moved from `.specify/.forgejo/` to `.forgejo/` so Codeberg picks them up; CI now runs `npm ci`, lint, test and build on the Node version in `.nvmrc`; the weekly security audit now runs `npm audit` on runtime dependencies. Removed the unused docs-portal workflow.
- `README.md` slimmed down: container deployment moved to `docs/DEPLOYMENT.md`, shared-stack ports corrected (frontend `5273`, backend `8888`), roadmap statuses refreshed.
- `AGENTS.md` now carries commands, workflow and a reference table to `docs/agents/`.
- Dev dependencies refreshed with `npm audit fix` (no runtime dependency changes).

### Removed

- Dead code flagged by lint: unused `svc` prop and `displayLabel` in `ServiceCard`, unused `rs` parameter in the `oneshot` rule.

### Fixed

- Enabling automatic runs for a service no longer switches the global switch back on after "Stop all automatic runs". Only a switch that was never set is turned on automatically; after a stop, use "Switch back on".
- Shared-state bootstrap no longer throws "Assignment to constant variable" when the server returns quota records.
- Weekly history view no longer lags one render behind the stored history.
- `getResetInfo` counts days on the user's local calendar day instead of UTC. For users far from UTC, "Resets in Nd" can change by one day near midnight; the day count shown and the one used by surplus rules now agree.

## [0.0.1] - 2026-04-13

### Added

- Initial project structure with Vite and React 18.
- Quota tracking system for multiple AI services (Claude, ChatGPT, Copilot, OpenRouter, Kilocode).
- Service-specific quota types: `consumed_pct`, `remaining_pct`, and `currency`.
- Task-based routing engine providing recommendations based on task type and current quotas.
- `localStorage` persistence for quota states.
- Clean, responsive UI with dark mode support.
- Summary bar showing monthly costs and services under pressure.
- `App.module.css` and component-scoped CSS modules for styling.
- Comprehensive `README.md` with project vision and roadmap.
- Initial set of routing rules in `src/data/rules.js`.
