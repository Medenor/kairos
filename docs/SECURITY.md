# Security

## Reporting a vulnerability

Do **not** open a public issue. Contact the maintainer privately through the Codeberg profile of [@medenor](https://codeberg.org/medenor) and include the version or commit, reproduction steps and impact. Only the latest `main` is supported.

## Threat model

Kairos is a **personal / home-lab tool**. The frontend is static and stores quota numbers in the browser. The optional backend is meant for a **trusted LAN** and holds only quota values and weekly snapshots, no secrets or personal data beyond a username.

## What the shared backend does and does not protect

| Control | Status |
| --- | --- |
| Network restriction | `LAN_ONLY=true` (default) rejects clients outside loopback and RFC1918 subnets (`ALLOWED_SUBNETS`); denials are logged as `security_events`. IPv4 only. |
| Authentication | `POST /auth/login` issues a bearer session (scrypt-hashed passwords, 12 h TTL). **Data routes (`/records`, `/sync`, `/migrations`, `/backups`) do not require it.** Access control is the LAN restriction alone ("local trust"). |
| CORS | `Access-Control-Allow-Origin: *`. Any web page opened on a LAN machine can call the API. |
| Default account | An empty database is seeded with user `owner` / password `password123` (`seedDemoData`). Change or remove it before exposing the server beyond your own machine. |
| SQL | The backend runs the `sqlite3` CLI with string-built SQL; dynamic values are escaped by `quoteSql()`. There are no prepared statements, so any new query that skips `quoteSql()` is an injection risk. |
| TLS | None. Terminate TLS in a reverse proxy if traffic leaves a trusted segment. |
| Rate limiting | None. |

`docker/docker-compose.shared.yml` sets `LAN_ONLY=false` and publishes ports `8888`/`5273`: never expose it to the internet.

## Known follow-ups

Tracked here until they become issues:

- Enforce `requireAuth` on data routes (or document and test "local trust" as a deliberate mode).
- Remove the default `owner` account in favour of first-run credential setup.
- Restrict CORS to a configurable origin list.
- Replace the `sqlite3` CLI shell-out with a driver using prepared statements.
- Upgrade Vite 5 (dev-server advisory GHSA-67mh-4wv8-2f99 via esbuild, development only; production dependencies report 0 vulnerabilities).

## Dependencies

Runtime dependencies are `react` and `react-dom` only. CI audits them weekly (`npm audit --omit=dev --audit-level=high`). Dev-tooling advisories are reviewed manually.
