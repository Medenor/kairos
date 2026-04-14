#!/usr/bin/env sh
set -eu

TAG="${1:-0.1.0}"
IMAGE_NAME="${IMAGE_NAME:-kairos}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_NAME="${CONTAINER_NAME:-kairos-local}"

scripts/docker/build-image.sh "$TAG"
CONTAINER_NAME="$CONTAINER_NAME" HOST_PORT="$HOST_PORT" scripts/docker/run-local.sh "$TAG"

curl -fsS "http://127.0.0.1:${HOST_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
echo "US1 local deployment verification passed for ${IMAGE_NAME}:${TAG}"
