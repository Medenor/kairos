#!/usr/bin/env sh
set -eu

COMPOSE_FILE="docker/docker-compose.shared.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "docker compose or docker-compose is required." >&2
  exit 1
fi

$COMPOSE -f "$COMPOSE_FILE" up --build -d

echo "Shared stack started."
echo "Frontend: http://localhost:5273"
echo "Backend health: http://localhost:8888/health"
