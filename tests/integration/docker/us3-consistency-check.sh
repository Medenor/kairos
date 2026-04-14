#!/usr/bin/env sh
set -eu

TAG="${1:-0.1.0}"
IMAGE_NAME="${IMAGE_NAME:-kairos}"

DEV_PORT="${DEV_PORT:-28080}"
STAGING_PORT="${STAGING_PORT:-28081}"

scripts/docker/build-image.sh "$TAG"

CONTAINER_A="kairos-dev-check"
CONTAINER_B="kairos-staging-check"

cleanup() {
  docker rm -f "$CONTAINER_A" "$CONTAINER_B" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d --name "$CONTAINER_A" -p "${DEV_PORT}:80" "${IMAGE_NAME}:${TAG}" >/dev/null
docker run -d --name "$CONTAINER_B" -p "${STAGING_PORT}:80" "${IMAGE_NAME}:${TAG}" >/dev/null

sleep 2
A_HEALTH="$(curl -fsS "http://127.0.0.1:${DEV_PORT}/healthz")"
B_HEALTH="$(curl -fsS "http://127.0.0.1:${STAGING_PORT}/healthz")"

if [ "$A_HEALTH" != "$B_HEALTH" ]; then
  echo "Health responses differ across environments" >&2
  exit 1
fi

echo "US3 consistency verification passed for tag ${TAG}"
