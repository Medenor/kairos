# Kairos - Know which AI to use right now

<h1 align="center"><img src="public/logo.webp" width="250" alt="Kairos Logo"></h1>

Quota-aware routing across Claude, ChatGPT, Copilot, and pay-as-you-go APIs. A lightweight dashboard to track your AI subscription quotas and get instant routing recommendations based on what you're about to do.

## Why

Managing AI subscriptions means juggling different quota types — weekly resets, 5h slots, monthly request caps, and pay-as-you-go balances across Claude, ChatGPT, GitHub Copilot, OpenRouter, and Kilocode. Without visibility, you default to your best tool for everything and hit limits at the wrong moment.

This tool tracks your quotas in one place and tells you which service to use right now.

## Features

- Per-service quota tracking with three input modes:
  - `consumed_pct` — how much you've used (Claude, Copilot)
  - `remaining_pct` — how much is left, matching the native UI display (ChatGPT Codex)
  - `currency` — numeric balance in $ or € (OpenRouter, Kilocode)
- Task-based routing: select what you're doing, get a recommendation with its reasoning
- Per-service reset date tracking with automatic `days until reset` / `overdue` status, used by the recommendations
- Weekly history: one quota snapshot per calendar week (Monday start, local time), updated in place, 52 completed weeks retained. Missing weeks and services show as explicit gaps, never as zero consumption. Removed services stay reviewable
- Works fully offline: state is persisted in `localStorage`
- Optional shared backend for LAN-wide consistency across devices, one-click localStorage migration, backup and restore
- Reset button to clear all quotas back to defaults
- Dark mode support

## Services tracked

| Service | Quota type | Reset |
|---|---|---|
| Claude | Weekly + 5h slot (consumed %) | Weekly |
| ChatGPT Codex | Weekly + 5h slot (remaining %) | Weekly |
| GitHub Copilot | Monthly request quota (consumed %) | Monthly |
| OpenRouter | Credit balance ($) | Manual top-up |
| Kilocode | Credit balance ($) | Manual top-up |

## Getting started

Requires Node.js 20 or newer.

```bash
git clone https://codeberg.org/medenor/kairos.git
cd kairos
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). That's all you need: the shared backend is optional.

### Optional: shared backend (LAN)

```bash
npm run backend:migrate
npm run backend:start      # http://localhost:8080  (needs the sqlite3 CLI)
# in another terminal
npm run dev
```

Or run the whole stack with Docker: `scripts/docker/run-shared.sh` (frontend `http://localhost:5273`, backend health `http://localhost:8888/health`).

> The shared backend is built for a trusted home network. Read [docs/SECURITY.md](docs/SECURITY.md) before exposing it.

### Commands

```bash
npm run lint       # ESLint
npm test           # frontend + backend tests
npm run build      # production bundle in dist/
```

## Documentation

| Document | What's inside |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, quality gates |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Static build, container, shared stack, rollback |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, backend limits, reporting |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to propose a change |
| [docs/agents/](docs/agents/) | Architecture, frontend, backend, testing, git workflow |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [specs/](specs/) | Feature specifications (spec-driven development) |

## Customising your services

Edit `src/data/services.js` to change costs, add quotas, or adjust default values.

Edit `src/data/rules.js` to adjust the routing logic and thresholds.

## Stack

- Frontend: React 18 + Vite 5, CSS Modules. Only `react` and `react-dom` at runtime
- Backend (optional): Node.js `http` server, SQLite via the `sqlite3` CLI, no npm dependencies
- Tests: built-in `node:test`. Lint: ESLint
- Delivery: static build or Nginx container

## Contributing

Issues and PRs welcome — see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). Keep it dependency-free as much as possible.

## Development Constitution

This repository is governed by the project constitution at
`.specify/memory/constitution.md`.

When proposing changes, include:
- user-value impact on routing or quota visibility
- deterministic/traceable rule behavior
- regression verification evidence for behavior changes
- recommendation explainability updates where applicable

## Roadmap

### Core functionality

1. ✅ **Reset date tracking** — enter the last reset date per service, display days remaining until the next reset (`specs/003-reset-date-tracking`)
2. ✅ **Weekly history** — a quota snapshot per week to identify consumption patterns (`specs/005-weekly-history`)
3. **Service toggle** — enable/disable a service without deleting it (useful when suspending a subscription)

### Routing intelligence

4. ✅ **Reset-aware recommendations** — recommendations account for upcoming and overdue resets (`specs/004-reset-aware-recommendations`)
5. **Configurable thresholds** — make routing thresholds (50%, 75%, 95%) editable in a settings panel rather than hardcoded in `rules.js`
6. **Custom task types** — add your own task types with associated routing rules, without touching the code

### UX

7. **Quick-update shortcuts** — +10% / -10% buttons on each gauge for fast updates without precise slider interaction
8. **Recommendation history** — log of the last 10 recommendations with timestamps, to review decision patterns over time

### Portability

9. **Export / import JSON** — save and restore a full configuration (services, thresholds, history) — useful when switching machines or sharing a setup

### Extensibility

10. **Generic service schema** — add any service via UI (name, cost, quota type, currency, reset window) without touching the code — makes the tool truly generic

### Hardening

11. **Shared backend security** — enforce authentication on data routes, remove the default account, restrict CORS, use prepared statements (see [docs/SECURITY.md](docs/SECURITY.md#known-follow-ups))

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

## Disclaimer – Spec Driven Development & AI collaboration

The first iteration was prototyped through an iterative dialogue with Claude (Anthropic), using the Artifacts feature.

For the future, this repository will be developed using a *Spec Driven Development* approach, with extensive AI collaboration throughout the process. AI is used to build and brainstorm detailed specifications before delegating coding tasks. The development follows a collaborative process where AI handles implementation, while human oversight ensures quality through review, testing, and debugging.

Transparency matters: this project reflects a comprehensive human–AI collaborative workflow from specification to deployment.
