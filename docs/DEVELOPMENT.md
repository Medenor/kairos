# Developer Guide

The canonical command surface is `npm` scripts at the repository root (there is no Makefile: the project is Node-only).

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20 LTS or newer (`.nvmrc` pins 20) | `node --version` |
| npm | 10+ | `npm --version` |
| `sqlite3` CLI | any recent 3.x (backend only) | `sqlite3 --version` |
| Docker | optional, for container workflows | `docker --version` |

## Quick reference

```bash
npm ci                   # install (reproducible, uses package-lock.json)
npm run dev              # frontend dev server  -> http://localhost:5173
npm run backend:migrate  # create/upgrade the SQLite DB (backend/data/kairos.db)
npm run backend:start    # shared-state API     -> http://localhost:8080
npm run backend:dev      # same, with --watch
npm run lint             # ESLint (frontend + backend)
npm run lint:fix         # auto-fix
npm test                 # frontend + backend tests
npm run build            # production bundle in dist/
npm run preview          # serve dist/ locally
```

Kairos ships no provider list: on a clean profile the dashboard is empty and you declare your own providers (name, quotas, reset schedule, fit per task) with **Add provider**. The frontend works without the backend. To try shared mode, run `backend:migrate`, `backend:start`, then `dev`. The frontend looks for the API on ports `8888` and `8080` of the current host; override with `VITE_SHARED_API_BASE_URL` (see [DEPLOYMENT.md](DEPLOYMENT.md)).

A first run seeds a demo workspace and an `owner` user (see [SECURITY.md](SECURITY.md)); use `LAN_ONLY=true` (default) on untrusted networks.

## Quality gates

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR: `npm ci`, `npm run lint`, `npm test`, `npm run build`. A weekly job (`security-audit.yml`) runs `npm audit --omit=dev --audit-level=high`. Make the `verify` job of the `CI` workflow a required status check on `main` (branch protection in the GitHub repository settings) so it blocks merges.

## Linting

`eslint.config.js` (flat config) covers `src/` (React + hooks rules) and `backend/` (Node). Unused variables are errors unless prefixed with `_`. Warnings are allowed but should not grow.

## Editor

`.editorconfig` sets UTF-8, LF, two-space indentation. No formatter is enforced yet.

## Layout and conventions

See [agents/architecture.md](agents/architecture.md), [agents/frontend.md](agents/frontend.md), [agents/backend.md](agents/backend.md), [agents/testing.md](agents/testing.md).

## Spec-driven development

Features are specified under `specs/NNN-name/` with [spec-kit](https://github.com/github/spec-kit) (`.specify/`, slash commands `/speckit-*`). The project constitution lives at `.specify/memory/constitution.md`; plans, specs and PRs must align with it.
