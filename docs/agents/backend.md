# Backend Conventions

Plain Node.js (20+) `http` server with **zero npm dependencies**. Entry point `backend/src/server.js` (`createApp()`), configuration in `backend/src/config/env.js`.

## Layout and layering

`routes (src/api/routes) -> services (src/services) -> repositories (src/db/repositories) -> db client (src/db/client.js)`

- Routes parse/validate input (`api/validation.js`) and shape responses; no SQL in routes beyond the existing auth/workspace lookups.
- Business rules (versioning, conflicts, idempotent migration, backup/restore) live in services.
- Failures are thrown as `ApiError(status, CODE, message)` and rendered by `toErrorEnvelope`.

## Provider records (feature 007)

The provider catalogue needs **no backend change**: `provider:{id}` (a definition or a tombstone) and `catalogue-order` are ordinary `routing_config` records, so versioning, `409` conflicts, `sync/pull` and backup/restore apply unchanged. Deleting a provider is a versioned `PUT` of a tombstone, never an HTTP delete. `backend/tests/contract/provider-records.contract.test.js` characterises this.

## SQLite access

The database client shells out to the **`sqlite3` CLI** (`execFileSync('sqlite3', ...)`); there is no driver. Consequences:

- `sqlite3` must be installed wherever the backend runs (the dev compose file does `apk add sqlite`; CI installs it).
- Queries are strings. **Every dynamic value must go through `quoteSql()`.** Never interpolate raw input. Values from migrations/seed are the only exception.
- Writes that must be atomic go through `db.transaction(...)` (`BEGIN IMMEDIATE`).

## Migrations

SQL files in `backend/src/migrations/`, numbered (`001_initial_schema.sql`), applied by `npm run backend:migrate` and on server start. Never edit a released migration: add a new numbered file. Use `IF NOT EXISTS` and keep them idempotent.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Listen address |
| `API_PREFIX` | `/api/v1` | Route prefix |
| `DB_PATH` | `./backend/data/kairos.db` | SQLite file |
| `LAN_ONLY` | `true` | Reject clients outside `ALLOWED_SUBNETS` |
| `ALLOWED_SUBNETS` | loopback + RFC1918 | Comma-separated CIDRs (IPv4) |
| `AUTH_SESSION_TTL_SECONDS` | `43200` | Session lifetime |

Values can also come from `backend/.env` (git-ignored). Process env wins.

## Checks

```bash
npm run lint && npm run test:backend
```
