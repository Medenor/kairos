# Deployment

Three ways to run Kairos, from simplest to most complete.

| Mode | What runs | Shared state |
| --- | --- | --- |
| Static | `dist/` on any web server | No (browser `localStorage` only) |
| Container | Nginx serving the static build | No |
| Shared stack | Backend API + frontend | Yes, LAN-wide |

## Static build

```bash
npm ci && npm run build
```

Output goes to `dist/` (relative base, so it can be hosted in a subfolder): Codeberg Pages, Netlify, Nginx, etc.

To point the build at a shared backend, set the API URL at build time:

```bash
VITE_SHARED_API_BASE_URL=http://my-nas:8080/api/v1 npm run build
```

## Container (static frontend)

Multi-stage `Dockerfile`: Node build stage, then Nginx runtime with SPA routing and a readiness endpoint at `/healthz`.

- `HOST_PORT` must be numeric, 1-65535 (scripts fail fast otherwise). Defaults: local `8080`, self-hosted `80`.
- Always use an **immutable version tag**, never `latest`.

```bash
npm run docker:build -- 0.1.0                  # build kairos:0.1.0
npm run docker:run:local -- 0.1.0              # http://localhost:8080 (+ /healthz)
HOST_PORT=9090 CONTAINER_NAME=kairos-local npm run docker:run:local -- 0.1.0
npm run docker:run:selfhosted -- 0.1.0         # port 80, restart policy unless-stopped
HOST_PORT=8081 RESTART_POLICY=always CONTAINER_NAME=kairos npm run docker:run:selfhosted -- 0.1.0
```

Sample runtime profiles: `docker/env/{dev,staging,prod}.env`.

### Verify

```bash
npm run docker:verify -- 0.1.0
npm run docker:test:us1 -- 0.1.0   # local deploy
npm run docker:test:us2 -- 0.1.0   # self-hosted health + restart
npm run docker:test:us3 -- 0.1.0   # consistency check
```

### Rollback

Redeploy the previous immutable tag, then re-check health. Example if `0.1.1` fails:

```bash
docker rm -f kairos          # confirm this is the container you mean to replace first
docker run -d --name kairos --restart unless-stopped -p 80:80 kairos:0.1.0
curl -fsS http://127.0.0.1/healthz
```

## Shared stack (backend + frontend)

```bash
scripts/docker/run-shared.sh      # or: npm run docker:run:shared
```

| Service | URL |
| --- | --- |
| Frontend (Vite dev server) | `http://localhost:5273` |
| Backend health | `http://localhost:8888/health` |

`docker/docker-compose.shared.yml` is a **development/home-lab stack**: it bind-mounts the repo, runs `npm install` at start and sets `LAN_ONLY=false` so containers can reach the API. Do not expose it to the internet. Read [SECURITY.md](SECURITY.md) first.

Without Docker:

```bash
npm run backend:migrate && npm run backend:start   # :8080
npm run dev                                        # :5173
```

### Backend environment

See the variable table in [agents/backend.md](agents/backend.md#configuration). Data lives in `DB_PATH` (default `backend/data/kairos.db`); back it up with the in-app Backup panel or by copying the file while the server is stopped.

## Surplus runner (optional)

The runner starts approved ideas with your subscription-signed-in `claude` or `codex` CLI when a provider you declared has quota that would expire unused at its reset. It runs on one device, is optional, and is not needed by the dashboard: without it, the dashboard only suggests ideas.

The command surface is specified in [`specs/006-surplus-runner/contracts/runner-cli.md`](../specs/006-surplus-runner/contracts/runner-cli.md).

### Prerequisites

- Node.js 26 or newer, no extra npm packages
- Shared mode with a workspace (`Backend environment` above). Without shared mode, automatic runs are unavailable and the runner refuses to start
- `claude` and/or `codex` on `PATH`, signed in with your subscription. Do not set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `CODEX_API_KEY`: preflight fails with `billing_guard` if they are present, or if the login method is not the subscription sign-in
- Shared store reachable from the runner device

### Configure and designate

```bash
npm run runner -- config     # creates ~/.kairos-runner/config.json
npm run runner -- approve    # review each requested idea, then type "yes"
npm run runner -- start
```

- `config` asks for the device id and name, API base, workspace id, the projects base folder (needed for relative working folders) and the copy exclusions. Providers are allowed separately with `allow <name-or-id>`, which pins the provider to its tool on this device. Copy exclusions are shown and editable before approval.
- The first `start` on a workspace designates that device as the runner and prints the disclosures for each allowed provider.
- Another device that calls `start` exits with code 3 while the first one is designated, even after the first runner stopped and its lease expired. To move the role, run `npm run runner -- config --take-over` on the new device, then `start`. The old runner exits on its next heartbeat.
- Automatic runs stay off per provider until you enable them in the dashboard and acknowledge the disclosures.
- `$KAIROS_RUNNER_HOME` changes the runner's base directory from `~/.kairos-runner/`.

Approval happens only on the runner device. An idea requested from another device, or edited after approval, does not run until you run `approve` on the runner device.

### Stop

- `npm run runner -- stop` creates `~/.kairos-runner/STOP` and sets `autoRunEnabled=false` in the shared store. A running process is terminated within 5 seconds.
- The global stop control in the dashboard does the same from any device. No new run starts until automatic runs are re-enabled.
- Deleting `STOP` alone does not re-enable runs; re-enable each provider in the dashboard.

### Local files and clean-up

Config, approvals and the journal are stored in `~/.kairos-runner/` (directory mode 0700, files 0600). Disposable copies and full run output are in `~/.kairos-runner/runs/`. `npm run runner -- clean [runId | --all]` removes them. The original working folder is never written.

### Security and provider notice

- Idea text, context and the disposable copy of the working folder (minus exclusions) are sent to the chosen provider when a run starts.
- The shared store is **not authenticated** on the local network. Any device on the LAN can read ideas stored in shared mode, including their text. Do not put secrets in ideas. See [SECURITY.md](SECURITY.md).
- Provider rules on automated usage of subscriptions can change. If a provider stops covering automated use, switch every provider back to suggestion-only in the dashboard.
