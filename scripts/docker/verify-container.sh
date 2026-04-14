#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-kairos}"
TAG="${1:-0.1.0}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_NAME="${CONTAINER_NAME:-kairos-verify}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if ! docker image inspect "${IMAGE_NAME}:${TAG}" >/dev/null 2>&1; then
  echo "Image ${IMAGE_NAME}:${TAG} not found. Build it first." >&2
  exit 1
fi

docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:80" \
  "${IMAGE_NAME}:${TAG}" >/dev/null

for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
    echo "Health endpoint reachable on /healthz"
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${HOST_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null

echo "Container verification passed for ${IMAGE_NAME}:${TAG}"
