#!/usr/bin/env sh
set -eu

TAG="${1:-0.1.0}"
HOST_PORT="${HOST_PORT:-18080}"
CONTAINER_NAME="${CONTAINER_NAME:-kairos-selfhosted-test}"

CONTAINER_NAME="$CONTAINER_NAME" HOST_PORT="$HOST_PORT" scripts/docker/run-selfhosted.sh "$TAG"

docker restart "$CONTAINER_NAME" >/dev/null
sleep 2
curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null

echo "US2 self-hosted restart and health verification passed"
