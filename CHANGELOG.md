# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [UNRELEASED]

### Added

- Dockerized delivery with multi-stage `Dockerfile` (Node build stage + Nginx runtime stage).
- Nginx runtime config with SPA routing and readiness endpoint at `/healthz`.
- OCI image labels and immutable-tag build script (`scripts/docker/build-image.sh`).
- Local deployment, self-hosted deployment, and verification scripts under `scripts/docker/`.
- Integration verification scripts for US1/US2/US3 under `tests/integration/docker/`.
- Environment profile samples for `dev`, `staging`, and `prod` in `docker/env/`.
- Container runtime contract schema, quickstart deployment matrix, and verification evidence artifacts.

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
