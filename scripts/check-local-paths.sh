#!/usr/bin/env bash
# Fails when tracked files contain a developer's machine-specific path (home directory with a real
# account name, or an agent scratchpad under /private/tmp). See docs/agents/git-workflow.md.
#
# Generic fixtures such as /Users/me or /home/test are fine. Add your own account name to the pattern
# with LOCAL_PATH_EXTRA, for example: LOCAL_PATH_EXTRA='/Users/jane' npm run lint:paths
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The current account's home directory plus agent scratchpad folders.
home_dir="${HOME:-}"
patterns=("/private/tmp/claude-" "/tmp/claude-")
[ -n "$home_dir" ] && [ "$home_dir" != "/" ] && patterns+=("$home_dir/")
[ -n "${LOCAL_PATH_EXTRA:-}" ] && patterns+=("$LOCAL_PATH_EXTRA")

status=0
for pattern in "${patterns[@]}"; do
  if git grep -n -I -F -e "$pattern" -- . ':!scripts/check-local-paths.sh' ':!package-lock.json' ':!backend/package-lock.json'; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo
  echo "check-local-paths: machine-specific paths found above. Use repo-relative paths, ~, or a placeholder." >&2
fi
exit "$status"
