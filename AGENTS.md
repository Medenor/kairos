# kairos Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-04

## Active Technologies
- Language and runtime: JavaScript (ES Modules), Node.js 26 (`engines >=26`) for frontend build, backend and runner
- Frontend: React 18, React DOM 18, Vite 5, CSS Modules; runtime dependencies stay at React + React DOM
- Backend (optional): Node `http` server with the `sqlite3` CLI (WAL mode), no framework and no dependencies; records in `shared_records` (`quota_state`, `routing_config`, `snapshot`), revisions, migration jobs and backups
- Runner (optional): `runner/` CLI on Node built-ins only; local files under `~/.kairos-runner/`
- Local storage (`localStorage`): quota state with reset dates and reading stamps, weekly history, `kairos:surplus:*` (ideas, policy, runs, cycles), and for 007 `kairos:providers` (provider catalogue); shared mode syncs them as the record types above, with no schema change
- Container: multi-stage `Dockerfile` (build on `node:26-alpine`, serve the static bundle with `nginx:1.27-alpine`), helpers in `docker/` and `scripts/docker/`

## Project Structure

```text
src/        React frontend (components, hooks, pure logic, rules, services)
backend/    Optional shared-state API (Node http + sqlite3 CLI)
docker/     Container runtime config
scripts/    Docker helper scripts
specs/      Spec-driven-development artifacts (one folder per feature)
docs/       Developer, deployment and security documentation
```

## Commands

npm run lint && npm test && npm run build

## Code Style

JavaScript (ES Modules), Node.js 26 (build/runtime baseline). ESLint flat config (`eslint.config.js`); unused variables must be prefixed `_`.

## Recent Changes
- 007-dynamic-providers: User-declared providers replace the fixed service list; generic routing in `src/routing/`, catalogue in `src/providers/`, runner allowance pinned to provider id and tool (planned, not yet implemented)
- 006-surplus-runner: Idea queue, pure surplus evaluation in `src/surplus/`, optional local `runner/` CLI
- 005-weekly-history: Weekly snapshots with 52-week retention and a review panel
- 003-reset-date-tracking: Per-service reset dates and reset-aware recommendations
- 002-shared-state-backend: Optional shared-state API with SQLite, sync, migration and backups


<!-- MANUAL ADDITIONS START -->
## Overview

Kairos is a quota-aware routing dashboard: it tracks the quotas of the AI providers the user declares (no provider list is shipped) and recommends which one to use for a task. A static React frontend works fully offline; an optional LAN backend shares state across devices. Hosted on [Codeberg](https://codeberg.org/medenor/kairos) (Forgejo), not GitHub. Licensed AGPL-3.0-or-later.

## Commands

`package.json` scripts are the canonical command surface (details: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)):

```bash
npm run dev       # frontend dev server (:5173)
npm run lint      # ESLint, frontend + backend
npm test          # frontend + backend tests (node:test)
npm run build     # production bundle in dist/
```

- Backend and its tests need the `sqlite3` CLI on `PATH`.
- Do not stop, remove or replace a running `kairos` container to test something: see [git-workflow.md](docs/agents/git-workflow.md#docker-safety).
- Never commit machine-specific paths (home directory with a real account name, `/private/tmp` scratchpads). Use repo-relative paths or `~`, and run `npm run lint:paths`: see [git-workflow.md](docs/agents/git-workflow.md#no-machine-specific-paths-in-commits).

## Before non-trivial work

1. Read [`.specify/memory/constitution.md`](.specify/memory/constitution.md): routing value first, deterministic and explainable rules, verified changes, minimal dependencies, local-by-default data.
2. Read the feature spec under `specs/NNN-*/` and the tests of the code you touch.
3. Read [git-workflow.md](docs/agents/git-workflow.md): work on a branch, open a PR, Conventional Commits.

## Reference

| Topic | File |
| --- | --- |
| Architecture, data flow, persistence, API | [architecture.md](docs/agents/architecture.md) |
| Frontend conventions, hooks, rules | [frontend.md](docs/agents/frontend.md) |
| Backend conventions, SQLite access, config | [backend.md](docs/agents/backend.md) |
| Testing conventions and how to run suites | [testing.md](docs/agents/testing.md) |
| Git workflow and Docker safety | [git-workflow.md](docs/agents/git-workflow.md) |
| Step-by-step workflow and common pitfalls | [workflow-and-pitfalls.md](docs/agents/workflow-and-pitfalls.md) |

Also: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md), [`CHANGELOG.md`](CHANGELOG.md).

## Rules that are easy to miss

- Runtime dependencies stay at React + React DOM unless justified in writing.
- Every recommendation needs a `reason`; routing-rule changes need a before/after scenario test.
- Backend SQL is string-built: every dynamic value goes through `quoteSql()`.
- Provider ids (`p_…`) and quota ids (`q_…`) are never derived from names; the persisted field `serviceId` on ideas, runs and cycles holds a provider id (old records may hold a former service id, read-only). Never name a provider in `src/providers`, `src/routing`, `src/surplus` or `runner` (guard test). The shared catalogue never authorises a run: only the runner's local `allowProviders`, pinned to provider id and tool.
- Update `CHANGELOG.md` `[UNRELEASED]` for user-visible changes.
- This file is partly generated by spec-kit; edit only inside this `MANUAL ADDITIONS` block.
<!-- MANUAL ADDITIONS END -->
