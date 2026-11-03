# Git Workflow

Hosted on [Codeberg](https://codeberg.org/medenor/kairos) (Forgejo), not GitHub. CI runs from `.forgejo/workflows/`.

- **Always work on a branch.** Do not commit non-trivial changes straight to `main`. Branch, push, open a PR using `.forgejo/PULL_REQUEST_TEMPLATE.md`, even for solo work, so CI runs.
- **Branch names:** spec-kit features use `NNN-short-name` (sequential numbering, e.g. `005-weekly-history`); everything else uses `type/short-name` (`chore/…`, `fix/…`, `docs/…`).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`; optional scope, e.g. `fix(rules): …`).
- **Docs-only exception:** a tiny documentation-only change may go to `main` directly only when the maintainer says so for that change.
- **Read-only tasks stay read-only.** "Investigate" or "diagnose" is not permission to commit, push or open a PR.
- Never force-push `main`; never skip hooks or CI to get a change in.
- Do not commit: `.env*`, `backend/data/`, `backend/backups/`, `dist/`, `node_modules/`.
- Update `CHANGELOG.md` (`[UNRELEASED]`) for user-visible changes.

## Docker safety

`docker/docker-compose.shared.yml` mounts the repo (`..:/app`) and publishes ports `8888` (backend) and `5273` (frontend). Before running `docker rm`, `docker compose down -v`, or anything that removes volumes/containers, check what the container holds (`docker ps`, `docker inspect`). A self-hosted `kairos` container (`npm run docker:run:selfhosted`) may be a live instance: do not stop, remove or replace it for a smoke test. Use a different `CONTAINER_NAME` and `HOST_PORT` instead.
