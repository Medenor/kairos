# kairos Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-14

## Active Technologies
- JavaScript (ES Modules), Node.js 20 LTS for backend and frontend + Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), auth/session middleware, schema validation library, SQLite driver (002-shared-state-backend)
- SQLite (WAL mode) for v1 shared persistence, migration metadata, revisions, and backup manifests (002-shared-state-backend)

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
- 002-shared-state-backend: Added JavaScript (ES Modules), Node.js 20 LTS for backend and frontend + Existing React 18 + Vite 5 frontend; backend web framework (Express/Fastify class), auth/session middleware, schema validation library, SQLite driver

- 001-docker-container: Added JavaScript (ES Modules), Node.js 20 LTS (build/runtime baseline) + React 18, React DOM 18, Vite 5, static web server in container runtime

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
