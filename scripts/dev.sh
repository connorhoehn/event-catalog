#!/usr/bin/env bash
# Bring up the full event-catalog dev stack:
#   redis (docker) + message-queue (../message-queue) + event-catalog
# Streams all logs to this terminal; Ctrl+C tears everything down.

set -euo pipefail

EC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MQ_DIR="$(cd "$EC_DIR/../message-queue" && pwd)"
LOG_DIR="$EC_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

REDIS_CONTAINER="event-catalog-dev-redis"
MQ_PORT="${MQ_PORT:-3004}"
EC_PORT="${EC_PORT:-3010}"
# REDIS_URL is required by the server (it refuses to boot without one rather
# than silently dialling localhost from inside a container). This script
# starts redis itself, so supply the matching URL.
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

pids=()
cleanup() {
  echo
  echo "[dev] shutting down..."
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  docker rm -f "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  echo "[dev] done."
}
trap cleanup EXIT INT TERM

# 1. Redis
if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
  echo "[dev] redis container already running"
elif lsof -iTCP:6379 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev] something already listening on :6379 — assuming redis, skipping container"
else
  echo "[dev] starting redis on :6379"
  docker run --rm -d --name "$REDIS_CONTAINER" -p 6379:6379 redis:7-alpine >/dev/null
fi

# 2. Admin UI build (only if missing)
if [[ ! -f "$EC_DIR/src/admin/dist/index.html" ]]; then
  echo "[dev] building admin UI (one-time)"
  (cd "$EC_DIR" && npm run build:admin)
fi

# 3. message-queue
echo "[dev] starting message-queue on :$MQ_PORT  (logs: $LOG_DIR/message-queue.log)"
(cd "$MQ_DIR" && PORT="$MQ_PORT" npm run dev) > "$LOG_DIR/message-queue.log" 2>&1 &
pids+=($!)

# 4. event-catalog
echo "[dev] starting event-catalog on :$EC_PORT  (logs: $LOG_DIR/event-catalog.log)"
(cd "$EC_DIR" && PORT="$EC_PORT" REDIS_URL="$REDIS_URL" \
  MESSAGE_QUEUE_URL="http://localhost:$MQ_PORT" npm run dev) \
  > "$LOG_DIR/event-catalog.log" 2>&1 &
pids+=($!)

echo
echo "[dev] stack up:"
echo "  redis           → localhost:6379"
echo "  message-queue   → http://localhost:$MQ_PORT  (tail -f $LOG_DIR/message-queue.log)"
echo "  event-catalog   → http://localhost:$EC_PORT  (tail -f $LOG_DIR/event-catalog.log)"
echo "  admin UI        → http://localhost:$EC_PORT"
echo
echo "[dev] streaming combined logs (Ctrl+C to stop everything):"
echo

tail -f "$LOG_DIR/message-queue.log" "$LOG_DIR/event-catalog.log"
