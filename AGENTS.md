# kairos Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-24

## Active Technologies
- JavaScript (ES Modules), Node.js 20 LTS for backend and frontend + Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), auth/session middleware, schema validation library, SQLite driver (002-shared-state-backend)
- SQLite (WAL mode) for v1 shared persistence, migration metadata, revisions, and backup manifests (002-shared-state-backend)
- JavaScript (ES Modules), Node.js 20 LTS, React 18, Vite 5 + React DOM, existing shared quota state services, existing backend/state sync layer (002-shared-state-backend)
- Local workspace state with shared persistence already used by the app; reset-date data stored alongside existing service state (002-shared-state-backend)
- JavaScript (ES Modules), Node 20 LTS + React 18, Vite 5 (no new runtime dependencies) (003-reset-date-tracking)
- localStorage — existing, via `useQuotaState.js` / `useSharedQuotaState.js`; reset dates already persisted at `state[serviceId][RESET_DATE_KEY]` (003-reset-date-tracking)
- JavaScript (ES Modules), Node.js 20 LTS + React 18, React DOM 18, Vite 5, existing shared-state API client and backend services (no new runtime dependencies) (005-weekly-history)
- localStorage for local-first state; optional SQLite-backed shared records through existing `record_type='snapshot'` support for workspace-scoped sync (005-weekly-history)
- JavaScript (ES Modules), Node.js 20 LTS (frontend, backend and runner) + React 18, React DOM 18, Vite 5; new `runner/` CLI uses Node built-ins only (no new runtime dependency) (006-surplus-runner)
- localStorage `kairos:surplus:*` for ideas, policy, runs and cycle records; shared mode syncs them as `routing_config` records (no schema change); runner-local files under `~/.kairos-runner/` (006-surplus-runner)

- JavaScript (ES Modules), Node.js 20 LTS (build/runtime baseline) + React 18, React DOM 18, Vite 5, static web server in container runtime (001-docker-container)

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

JavaScript (ES Modules), Node.js 20 LTS (build/runtime baseline). ESLint flat config (`eslint.config.js`); unused variables must be prefixed `_`.

## Recent Changes
- 006-surplus-runner: Added idea queue, pure surplus evaluation in `src/surplus/`, and an optional local `runner/` CLI (zero dependencies)
- 005-weekly-history: Added JavaScript (ES Modules), Node.js 20 LTS + React 18, React DOM 18, Vite 5, existing shared-state API client and backend services (no new runtime dependencies)
- 003-reset-date-tracking: Added JavaScript (ES Modules), Node 20 LTS + React 18, Vite 5 (no new runtime dependencies)
- 002-shared-state-backend: Added JavaScript (ES Modules), Node.js 20 LTS, React 18, Vite 5 + React DOM, existing shared quota state services, existing backend/state sync layer


<!-- MANUAL ADDITIONS START -->
## Overview

Kairos is a quota-aware routing dashboard: it tracks AI subscription quotas (Claude, ChatGPT, Copilot, OpenRouter, Kilocode) and recommends which service to use for a task. A static React frontend works fully offline; an optional LAN backend shares state across devices. Hosted on [Codeberg](https://codeberg.org/medenor/kairos) (Forgejo), not GitHub. Licensed AGPL-3.0-or-later.

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
- Update `CHANGELOG.md` `[UNRELEASED]` for user-visible changes.
- This file is partly generated by spec-kit; edit only inside this `MANUAL ADDITIONS` block.
<!-- MANUAL ADDITIONS END -->
