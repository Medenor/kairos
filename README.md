# Kairos - Know which AI to use right now

<h1 align="center"><img src="public/logo.webp" width="250" alt="Kairos Logo"></h1>

Quota-aware routing across Claude, ChatGPT, Copilot, and pay-as-you-go APIs. A lightweight dashboard to track your AI subscription quotas and get instant routing recommendations based on what you're about to do.

## Why

Managing AI subscriptions means juggling different quota types — weekly resets, 5h slots, monthly request caps, and pay-as-you-go balances across Claude, ChatGPT, GitHub Copilot, OpenRouter, and Kilocode. Without visibility, you default to your best tool for everything and hit limits at the wrong moment.

This tool tracks your quotas in one place and tells you which service to use right now.

## Features

- Per-service quota tracking with three input modes:
  - `consumed_pct` — slider showing how much you've used (Claude, Copilot)
  - `remaining_pct` — slider showing how much is left, matching the native UI display (ChatGPT Codex)
  - `currency` — numeric balance in $ or € (OpenRouter, Kilocode)
- Task-based routing: select what you're doing, get a recommendation with reasoning
- Shared backend mode for LAN-wide state consistency across devices
- One-click localStorage migration into shared persistence
- Backup and restore operations from the UI
- State persisted in `localStorage` as offline fallback
- Per-service reset date tracking with automatic `days until reset` / `overdue` status
- Reset button to clear all quotas back to defaults
- Dark mode support

## Shared State Backend (Feature 002)

The repository now includes a LAN-scoped backend in `backend/`:

- LAN-local trusted API (`/api/v1`) with no user login flow
- SQLite persistence with versioned records and optimistic concurrency
- Retry-safe localStorage migration endpoint
- Backup create/list/restore endpoints

### Run frontend + backend locally

```bash
npm install
npm run backend:migrate
npm run backend:start
# in another terminal
npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:8080`.

### Run shared stack with Docker Compose

```bash
scripts/docker/run-shared.sh
```

This starts:
- frontend: `http://localhost:5173`
- backend health: `http://localhost:8080/health`

### Backend tests

```bash
npm run test:backend
```

## Services tracked

| Service | Quota type | Reset |
|---|---|---|
| Claude | Weekly + 5h slot (consumed %) | Weekly |
| ChatGPT Codex | Weekly + 5h slot (remaining %) | Weekly |
| GitHub Copilot | Monthly request quota (consumed %) | Monthly |
| OpenRouter | Credit balance ($) | Manual top-up |
| Kilocode | Credit balance ($) | Manual top-up |

## Getting started

```bash
git clone https://codeberg.org/medenor/kairos.git
cd kairos
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

Output in `dist/` — deploy anywhere static (Codeberg Pages, Netlify, self-hosted).

## Container deployment

Runtime notes:
- `HOST_PORT` must be numeric and in range `1-65535` (scripts fail fast on invalid values)
- Default ports: local `8080`, self-hosted `80`

### Build image with immutable tag

```bash
npm run docker:build -- 0.1.0
```

### One-command local deployment (US1)

```bash
npm run docker:run:local -- 0.1.0
```

Optional overrides:
```bash
HOST_PORT=9090 CONTAINER_NAME=kairos-local npm run docker:run:local -- 0.1.0
```

Expected result:
- App available at `http://localhost:8080`
- Readiness endpoint available at `http://localhost:8080/healthz`

### Self-hosted deployment and restart (US2)

```bash
npm run docker:run:selfhosted -- 0.1.0
docker restart kairos
```

Optional overrides:
```bash
HOST_PORT=8081 RESTART_POLICY=always CONTAINER_NAME=kairos npm run docker:run:selfhosted -- 0.1.0
```

Optional profile-based runtime examples:
- `docker/env/dev.env`
- `docker/env/staging.env`
- `docker/env/prod.env`

### Verification helpers

```bash
npm run docker:verify -- 0.1.0
npm run docker:test:us1 -- 0.1.0
npm run docker:test:us2 -- 0.1.0
npm run docker:test:us3 -- 0.1.0
```

### Rollback with explicit previous tag (US3)

If release `0.1.1` fails:

```bash
docker rm -f kairos
docker run -d --name kairos --restart unless-stopped -p 80:80 kairos:0.1.0
```

Re-run health checks after rollback:

```bash
curl -fsS http://127.0.0.1/healthz
```

## Customising your services

Edit `src/data/services.js` to change costs, add quotas, or adjust default values.

Edit `src/data/rules.js` to adjust the routing logic and thresholds.

## Stack

- React 18 + Vite
- CSS Modules
- No runtime dependencies beyond React

## Contributing

Issues and PRs welcome. Keep it dependency-free as much as possible.

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

1. **Reset date tracking** — enter the last reset date per service, display days remaining until the next reset
   - Status: implemented in `specs/003-reset-date-tracking`
2. **Weekly history** — save a quota state snapshot per week to identify consumption patterns over time
3. **Service toggle** — enable/disable a service without deleting it (useful when suspending a subscription)

### Routing intelligence

4. **Configurable thresholds** — make routing thresholds (50%, 75%, 95%) editable in a settings panel rather than hardcoded in `rules.js`
5. **Custom task types** — add your own task types with associated routing rules, without touching the code

### UX

6. **Quick-update shortcuts** — +10% / -10% buttons on each gauge for fast updates without precise slider interaction
7. **Recommendation history** — log of the last 10 recommendations with timestamps, to review decision patterns over time

### Portability

8. **Export / import JSON** — save and restore a full configuration (services, thresholds, history) — useful when switching machines or sharing a setup

### Extensibility

9. **Generic service schema** — add any service via UI (name, cost, quota type, currency, reset window) without touching the code — makes the tool truly generic

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

## Disclaimer – Spec Driven Development & AI collaboration

The first iteration was prototyped through an iterative dialogue with Claude (Anthropic), using the Artifacts feature.

For the future, this repository will be developed using a *Spec Driven Development* approach, with extensive AI collaboration throughout the process. AI is used to build and brainstorm detailed specifications before delegating coding tasks. The development follows a collaborative process where AI handles implementation, while human oversight ensures quality through review, testing, and debugging.

Transparency matters: this project reflects a comprehensive human–AI collaborative workflow from specification to deployment.
