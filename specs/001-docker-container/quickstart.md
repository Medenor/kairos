# Quickstart: Docker Container Packaging

## Goal

Build and run Kairos as a containerized static web app with a repeatable deployment path for local and self-hosted environments.

## Prerequisites

- Container runtime installed on target host
- Repository checked out at the target revision
- Network access to pull base images (for image build stage)

## 1. Build the application image

```bash
docker build -t kairos:0.1.0 .
```

Expected result:
- Build completes successfully.
- Image `kairos:0.1.0` is available locally.

## 2. Run container locally

```bash
docker run --rm -p 8080:80 --name kairos kairos:0.1.0
```

Expected result:
- Container starts without interactive prompts.
- Service is reachable at `http://localhost:8080`.

## 3. Verify health and app availability

Health/process verification:

```bash
docker ps --filter name=kairos
```

Functional verification:
- Open `http://localhost:8080`.
- Confirm dashboard loads and existing quota inputs/recommendation flow works.

## 4. Run on self-hosted server

Deploy the same image tag with host-appropriate port mapping:

```bash
docker run -d --restart unless-stopped -p 80:80 --name kairos kairos:0.1.0
```

Expected result:
- Service remains up after restart.
- Deployment behavior matches local startup behavior with environment-specific runtime config only.

## 5. Rollback procedure

If a release fails validation:

1. Stop current container.
2. Start a previously validated image tag.
3. Re-run health and functional verification steps.

## Verification Checklist

- [ ] Image builds successfully from clean checkout
- [ ] Container starts with documented runtime inputs
- [ ] Service endpoint is reachable after startup
- [ ] Startup failures produce actionable logs/messages
- [ ] Same image works across at least two environments
