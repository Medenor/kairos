# Quickstart: Docker Container Packaging

## Goal

Build and run Kairos as a containerized static web app with a repeatable deployment path for local and self-hosted environments.

## Prerequisites

- Container runtime installed on target host
- Repository checked out at the target revision
- Network access to pull base images (for image build stage)

## 1. Build the application image

```bash
scripts/docker/build-image.sh 0.1.0
```

Expected result:
- Build completes successfully.
- Image `kairos:0.1.0` is available locally.

## 2. Run container locally

```bash
scripts/docker/run-local.sh 0.1.0
```

Expected result:
- Container starts without interactive prompts.
- Service is reachable at `http://localhost:8080`.
- Readiness endpoint returns success at `http://localhost:8080/healthz`.

## 3. Verify health and app availability

Health/process verification:

```bash
docker ps --filter name=kairos-local
curl -fsS http://127.0.0.1:8080/healthz
```

Functional verification:
- Open `http://localhost:8080`.
- Confirm dashboard loads and existing quota inputs/recommendation flow works.
- Confirm deep-link refresh works (for example load `/` and refresh).

## 4. Run on self-hosted server

Deploy the same image tag with host-appropriate port mapping:

```bash
scripts/docker/run-selfhosted.sh 0.1.0
docker restart kairos
curl -fsS http://127.0.0.1:80/healthz
```

Expected result:
- Service remains up after restart.
- Deployment behavior matches local startup behavior with environment-specific runtime config only.

## 5. Multi-environment deployment matrix

Use the same immutable image tag in each environment:

| Environment | Profile File | Host Port | Restart Policy | Command |
|---|---|---:|---|---|
| dev | `docker/env/dev.env` | 8080 | unless-stopped | `HOST_PORT=8080 RESTART_POLICY=unless-stopped scripts/docker/run-selfhosted.sh 0.1.0` |
| staging | `docker/env/staging.env` | 8081 | unless-stopped | `HOST_PORT=8081 RESTART_POLICY=unless-stopped scripts/docker/run-selfhosted.sh 0.1.0` |
| prod | `docker/env/prod.env` | 80 | always | `HOST_PORT=80 RESTART_POLICY=always scripts/docker/run-selfhosted.sh 0.1.0` |

## 6. Rollback procedure

If a release fails validation:

1. Stop current container.
2. Start a previously validated image tag.
3. Re-run health and functional verification steps.

Example rollback from `0.1.1` to `0.1.0`:

```bash
docker rm -f kairos
docker run -d --name kairos --restart unless-stopped -p 80:80 kairos:0.1.0
curl -fsS http://127.0.0.1/healthz
```

## Verification Checklist

- [x] Image builds successfully from clean checkout
- [x] Container starts with documented runtime inputs
- [x] Service endpoint is reachable after startup
- [x] Startup failures produce actionable logs/messages
- [x] Same image works across at least two environments
