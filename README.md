# Kairos - Know which AI to use right now

<h1 align="center"><img src="public/logo.webp" width="250" alt="Kairos Logo"></h1>

Quota-aware routing across the AI providers you declare: subscriptions with percentage quotas and pay-as-you-go balances. A lightweight dashboard to track your quotas and get instant routing recommendations based on what you're about to do.

## Why

Managing AI subscriptions means juggling different quota types — weekly resets, 5h slots, monthly request caps, and pay-as-you-go balances across several providers. Without visibility, you default to your best tool for everything and hit limits at the wrong moment.

This tool tracks your quotas in one place and tells you which provider to use right now.

## Features

- Your own providers: no list is shipped, you declare each one (name, quotas, reset schedule, cost, fit per task) and can edit, duplicate, reorder or delete it
- Per-quota tracking with three explicit input modes, chosen per quota:
  - `consumed_pct` — how much you've used
  - `remaining_pct` — how much is left, matching a native UI that shows it that way
  - `currency` — numeric balance in $ or € with a low-balance level
- Task-based routing: select what you're doing, get a recommendation with its reasoning
- Per-provider reset schedule (weekly, monthly, custom days or none) and reset date tracking with automatic `days until reset` / `overdue` status, used by the recommendations
- Weekly history: one quota snapshot per calendar week (Monday start, local time), updated in place, 52 completed weeks retained. Missing weeks and providers show as explicit gaps, never as zero consumption. Removed providers stay reviewable
- Works fully offline: state is persisted in `localStorage`
- Optional shared backend for LAN-wide consistency across devices, one-click localStorage migration, backup and restore
- "Clear readings" to forget all quota values (your providers are kept)
- Dark mode support
- Idea queue: capture ideas with optional context and working folder, prioritise and archive them
- Surplus suggestions: flags a provider whose quota will expire unused at its reset, with the rules that led to the suggestion
- Reset-cycle history: quota left at each reset and the part consumed by runs
- Optional surplus runner (local CLI, shared mode only), see [Optional: surplus runner](#optional-surplus-runner)

## Providers

Kairos does not know any provider in advance. On a clean profile the dashboard is empty and invites you to add your first one. Typical examples: a weekly subscription with a weekly quota and a 5-hour slot, a monthly request cap, or a pay-as-you-go credit balance. See [Declaring your providers](#declaring-your-providers).

## Getting started

Requires Node.js 26 or newer.

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

### Optional: surplus runner

The dashboard works without the runner. Without it, surplus is suggestion-only: Kairos shows which provider has quota expiring at its reset and which waiting idea fits, and you launch the idea yourself.

The runner is an optional local CLI (`runner/`, Node built-ins only) that can start approved ideas with your subscription-signed-in `claude` or `codex` CLI when surplus conditions hold. It needs:

- Node.js 26 or newer
- Shared mode with a workspace (see the shared backend above). Automatic runs are unavailable in local-only mode
- `claude` and/or `codex` on `PATH`, signed in with your subscription. Preflight fails if `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `CODEX_API_KEY` is set, so runs cannot bill the API

The command surface is specified in [`specs/006-surplus-runner/contracts/runner-cli.md`](specs/006-surplus-runner/contracts/runner-cli.md). Setup and operation are described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#surplus-runner-optional).

```bash
npm run runner -- config     # device id and name, API base, workspace, projects base folder
npm run runner -- allow      # allow a provider to run on this device (pinned to its tool)
npm run runner -- approve    # approve ideas on this device (required before any run)
npm run runner -- start      # begin the lease and evaluation loop
npm run runner -- stop       # create the STOP file and disable automatic runs
```

Runs are off by default for each provider. You enable them per provider in the dashboard, after acknowledging the disclosures, and allow the provider on the runner device with `allow`. Provider rules on automated usage of subscriptions can change; you can switch any provider back to suggestion-only at any time.

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

## Declaring your providers

Kairos ships no predefined provider: on first start the dashboard is empty. Use **Add provider** to declare each AI subscription or pay-as-you-go balance you use: a name, one to eight quotas (consumed %, remaining % or a currency balance), a reset schedule (weekly, monthly, a custom number of days, or none), an optional cost, colour, flags and note, and how well it fits each of the five task types. Everything can be edited, duplicated, reordered or deleted later; deleting keeps the weekly history, marked as removed.

The recommendation is computed only from what you declared (fit, quota pressure, reset timing) by the generic rules in `src/routing/`; there is nothing to edit in code to add a provider. Data from the previous fixed-provider version is left untouched and not shown.

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

1. ✅ **Reset date tracking** — enter the last reset date per provider, display days remaining until the next reset (`specs/003-reset-date-tracking`)
2. ✅ **Weekly history** — a quota snapshot per week to identify consumption patterns (`specs/005-weekly-history`)
3. **Provider toggle** — enable/disable a provider without deleting it (useful when suspending a subscription)

### Routing intelligence

4. ✅ **Reset-aware recommendations** — recommendations account for upcoming and overdue resets (`specs/004-reset-aware-recommendations`)
5. **Configurable thresholds** — make routing thresholds (50%, 75%, 95%) editable in a settings panel rather than constants in `src/routing/constants.js`
6. **Custom task types** — add your own task types with associated routing rules, without touching the code

### UX

7. **Quick-update shortcuts** — +10% / -10% buttons on each gauge for fast updates without precise slider interaction
8. **Recommendation history** — log of the last 10 recommendations with timestamps, to review decision patterns over time

### Portability

9. **Export / import JSON** — save and restore a full configuration (providers, thresholds, history) — useful when switching machines or sharing a setup

### Extensibility

10. ✅ **Generic provider schema** — add any provider via UI (name, cost, quota type, currency, reset window) without touching the code (`specs/007-dynamic-providers`)

### Hardening

11. **Shared backend security** — enforce authentication on data routes, remove the default account, restrict CORS, use prepared statements (see [docs/SECURITY.md](docs/SECURITY.md#known-follow-ups))

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

## Disclaimer – Spec Driven Development & AI collaboration

The first iteration was prototyped through an iterative dialogue with Claude (Anthropic), using the Artifacts feature.

For the future, this repository will be developed using a *Spec Driven Development* approach, with extensive AI collaboration throughout the process. AI is used to build and brainstorm detailed specifications before delegating coding tasks. The development follows a collaborative process where AI handles implementation, while human oversight ensures quality through review, testing, and debugging.

Transparency matters: this project reflects a comprehensive human–AI collaborative workflow from specification to deployment.
