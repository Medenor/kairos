#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-kairos}"
TAG="${1:-0.1.0}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"
CONTAINER_NAME="${CONTAINER_NAME:-kairos-local}"

if [ "$HOST_PORT" -lt 1 ] || [ "$HOST_PORT" -gt 65535 ]; then
  echo "Invalid HOST_PORT: $HOST_PORT (must be 1-65535)" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "A container named '$CONTAINER_NAME' already exists. Remove it first:" >&2
  echo "  docker rm -f $CONTAINER_NAME" >&2
  exit 1
fi

echo "Starting ${IMAGE_NAME}:${TAG} on http://localhost:${HOST_PORT}"
if ! docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_NAME}:${TAG}" >/dev/null; then
  echo "Failed to start container ${IMAGE_NAME}:${TAG}." >&2
  echo "Check image existence with: docker images | grep ${IMAGE_NAME}" >&2
  exit 1
fi

sleep 2
if ! docker exec "$CONTAINER_NAME" wget -qO- "http://127.0.0.1:${CONTAINER_PORT}/healthz" >/dev/null 2>&1; then
  echo "Container started but readiness check failed." >&2
  echo "Inspect logs with: docker logs $CONTAINER_NAME" >&2
  exit 1
fi

echo "Container '$CONTAINER_NAME' is ready."
echo "Stop with: docker rm -f $CONTAINER_NAME"
