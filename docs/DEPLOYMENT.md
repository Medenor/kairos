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
