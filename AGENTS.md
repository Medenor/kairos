# kairos Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-20

## Active Technologies
- JavaScript (ES Modules), Node.js 20 LTS for backend and frontend + Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), auth/session middleware, schema validation library, SQLite driver (002-shared-state-backend)
- SQLite (WAL mode) for v1 shared persistence, migration metadata, revisions, and backup manifests (002-shared-state-backend)
- JavaScript (ES Modules), Node.js 20 LTS, React 18, Vite 5 + React DOM, existing shared quota state services, existing backend/state sync layer (002-shared-state-backend)
- Local workspace state with shared persistence already used by the app; reset-date data stored alongside existing service state (002-shared-state-backend)
- JavaScript (ES Modules), Node 20 LTS + React 18, Vite 5 (no new runtime dependencies) (003-reset-date-tracking)
- localStorage — existing, via `useQuotaState.js` / `useSharedQuotaState.js`; reset dates already persisted at `state[serviceId][RESET_DATE_KEY]` (003-reset-date-tracking)

- JavaScript (ES Modules), Node.js 20 LTS (build/runtime baseline) + React 18, React DOM 18, Vite 5, static web server in container runtime (001-docker-container)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

JavaScript (ES Modules), Node.js 20 LTS (build/runtime baseline): Follow standard conventions

## Recent Changes
- 003-reset-date-tracking: Added JavaScript (ES Modules), Node 20 LTS + React 18, Vite 5 (no new runtime dependencies)
- 002-shared-state-backend: Added JavaScript (ES Modules), Node.js 20 LTS, React 18, Vite 5 + React DOM, existing shared quota state services, existing backend/state sync layer
- 002-shared-state-backend: Added JavaScript (ES Modules), Node.js 20 LTS for backend and frontend + Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), auth/session middleware, schema validation library, SQLite driver


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
