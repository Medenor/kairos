# Git Workflow

Hosted on [GitHub](https://github.com/Medenor/kairos). CI runs from `.github/workflows/`.

- **Always work on a branch.** Do not commit non-trivial changes straight to `main`. Branch, push, open a PR using `.github/PULL_REQUEST_TEMPLATE.md`, even for solo work, so CI runs.
- **Branch names:** spec-kit features use `NNN-short-name` (sequential numbering, e.g. `005-weekly-history`); everything else uses `type/short-name` (`chore/…`, `fix/…`, `docs/…`).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`; optional scope, e.g. `fix(rules): …`).
- **Docs-only exception:** a tiny documentation-only change may go to `main` directly only when the maintainer says so for that change.
- **Read-only tasks stay read-only.** "Investigate" or "diagnose" is not permission to commit, push or open a PR.
- Never force-push `main`; never skip hooks or CI to get a change in.
- Do not commit: `.env*`, `backend/data/`, `backend/backups/`, `dist/`, `node_modules/`.
- Update `CHANGELOG.md` (`[UNRELEASED]`) for user-visible changes.

## No machine-specific paths in commits

This repo is public. A path like a home directory with a real account name, or an agent scratchpad under `/private/tmp`, leaks the developer's username and folder layout, and it stays in git history.

- **Write repo-relative paths** in specs, plans, tasks, docs and comments (`src/utils.js`, `specs/006-surplus-runner/spec.md`). Use `~` for the home directory and a placeholder such as `<scratchpad>` for temp folders.
- **Spec-kit and subagents write absolute paths by default** (the `Input:` line of `plan.md` and `tasks.md`, task lines, verification notes). Rewrite them to repo-relative before committing.
- **Tests use neutral fixtures**: `/home/test`, `/Users/me`. Never a real account name.
- **Pasted output** (terminal logs, canary results, agent reports) often contains the same paths: redact before copying it into a doc.
- **Check before every commit**: `npm run lint:paths` (also part of `npm run lint`). It fails on the current account's home directory and on agent scratchpad folders. To check another account name too, run `LOCAL_PATH_EXTRA='/Users/name' npm run lint:paths`.
- If a path was already pushed, fix the working tree and tell the maintainer. Removing it from history means rewriting the branch, which is the maintainer's call, never an agent's.

## Docker safety

`docker/docker-compose.shared.yml` mounts the repo (`..:/app`) and publishes ports `8888` (backend) and `5273` (frontend). Before running `docker rm`, `docker compose down -v`, or anything that removes volumes/containers, check what the container holds (`docker ps`, `docker inspect`). A self-hosted `kairos` container (`npm run docker:run:selfhosted`) may be a live instance: do not stop, remove or replace it for a smoke test. Use a different `CONTAINER_NAME` and `HOST_PORT` instead.
