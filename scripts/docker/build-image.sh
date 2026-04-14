#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-kairos}"
TAG="${1:-}"

if [ -z "$TAG" ]; then
  echo "Usage: $0 <immutable-tag>" >&2
  echo "Example: $0 0.1.0" >&2
  exit 1
fi

# Enforce immutable, explicit tags for release traceability.
if [ "$TAG" = "latest" ]; then
  echo "Refusing mutable tag 'latest'. Use a version tag such as 0.1.0." >&2
  exit 1
fi

case "$TAG" in
  *:*)
    echo "Tag must not include ':'; pass only the tag component (for example 0.1.0)." >&2
    exit 1
    ;;
  *[!A-Za-z0-9._-]*)
    echo "Tag contains unsupported characters. Allowed: A-Z a-z 0-9 . _ -" >&2
    exit 1
    ;;
esac

BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if command -v git >/dev/null 2>&1; then
  VCS_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
else
  VCS_REF="unknown"
fi

echo "Building ${IMAGE_NAME}:${TAG}"
docker build \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  --build-arg VCS_REF="$VCS_REF" \
  --build-arg VERSION="$TAG" \
  -t "${IMAGE_NAME}:${TAG}" \
  .
