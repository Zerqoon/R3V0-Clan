#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

# This bot stores its SQLite database in a dedicated persistent data directory.
# Canonicalize before checking so a value such as /app/data/../../etc cannot
# bypass the guard and cause recursive ownership changes outside the volume.
case "$DATA_DIR" in
  /*) ;;
  *)
    echo "[startup] ERROR: DATA_DIR must be an absolute path; got: $DATA_DIR" >&2
    exit 1
    ;;
esac
DATA_DIR="$(realpath -m "$DATA_DIR")"
case "$DATA_DIR" in
  /app/data|/app/data/*) ;;
  *)
    echo "[startup] ERROR: DATA_DIR must resolve to /app/data or a subdirectory of it on Railway; got: $DATA_DIR" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p "$DATA_DIR"
  # Railway mounts volumes at runtime, so image-build chown does not affect the
  # mounted filesystem. Repair the directory and existing SQLite/WAL files now.
  chown -R bot:bot "$DATA_DIR"
  chmod -R u+rwX "$DATA_DIR"
  export HOME=/home/bot
  echo "[startup] Data directory ready: $DATA_DIR (owner bot:bot)"
  exec gosu bot:bot "$@"
fi

# Defensive path for environments that explicitly run the container as bot.
mkdir -p "$DATA_DIR" 2>/dev/null || true
if [ ! -w "$DATA_DIR" ]; then
  echo "[startup] ERROR: DATA_DIR '$DATA_DIR' is not writable by uid $(id -u)." >&2
  echo "[startup] On Railway, mount a Volume at /app/data and use the Dockerfile builder." >&2
  exit 1
fi
exec "$@"
