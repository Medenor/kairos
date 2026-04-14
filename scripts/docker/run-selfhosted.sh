#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-kairos}"
TAG="${1:-}"
HOST_PORT="${HOST_PORT:-80}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"
CONTAINER_NAME="${CONTAINER_NAME:-kairos}"
RESTART_POLICY="${RESTART_POLICY:-unless-stopped}"

if [ -z "$TAG" ]; then
  echo "Usage: $0 <immutable-tag>" >&2
  exit 1
fi

if [ "$TAG" = "latest" ]; then
  echo "Refusing mutable tag 'latest'. Use an immutable release tag." >&2
  exit 1
fi

case "$HOST_PORT" in
  '' | *[!0-9]*)
    echo "Invalid HOST_PORT: $HOST_PORT (must be a number between 1 and 65535)" >&2
    exit 1
    ;;
esac

if [ "$HOST_PORT" -lt 1 ] || [ "$HOST_PORT" -gt 65535 ]; then
  echo "Invalid HOST_PORT: $HOST_PORT (must be 1-65535)" >&2
  exit 1
fi

case "$RESTART_POLICY" in
  no | on-failure | unless-stopped | always) ;;
  *)
    echo "Invalid RESTART_POLICY: $RESTART_POLICY" >&2
    echo "Allowed values: no, on-failure, unless-stopped, always" >&2
    exit 1
    ;;
esac

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Existing container '$CONTAINER_NAME' found; replacing it."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart "$RESTART_POLICY" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  "${IMAGE_NAME}:${TAG}" >/dev/null

sleep 2
if ! curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
  echo "Container started but health check failed at /healthz" >&2
  echo "Inspect logs with: docker logs $CONTAINER_NAME" >&2
  exit 1
fi

echo "Self-hosted deployment is healthy: ${IMAGE_NAME}:${TAG} on port ${HOST_PORT}"
