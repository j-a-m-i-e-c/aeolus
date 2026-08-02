#!/bin/sh
# docker-entrypoint.sh — start-up wrapper for the Aeolus backend container.
#
# Purpose: self-heal the data-directory ownership before the app runs.
#
# The backend runs as the unprivileged "aeolus" user and stores its SQLite
# database (WAL mode) under a Docker volume mounted at the data directory.
# SQLite must create -wal/-shm sidecar files *in that directory*, so the
# directory has to be writable by the app user. A volume that was created
# root-owned by an earlier image or run makes the directory unwritable and the
# backend crash-loops with SQLITE_READONLY_DIRECTORY. Docker never re-applies
# image ownership to an existing volume, so we fix it here on every boot.
#
# If the container is started as root (the default), we ensure the data dir
# exists, chown it to the app user, then drop privileges via gosu. If it is
# already started as a non-root user (e.g. `docker run --user 1000`), we assume
# the operator has arranged writable storage and simply exec the command.
set -e

DB_PATH="${DB_PATH:-/app/data/aeolus.db}"
DATA_DIR="$(dirname "$DB_PATH")"
APP_USER="aeolus"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only chown when needed — avoids a slow recursive chown on large volumes
  # when ownership is already correct.
  if [ "$(stat -c '%U' "$DATA_DIR")" != "$APP_USER" ]; then
    echo "aeolus-entrypoint: fixing ownership of $DATA_DIR -> $APP_USER" >&2
    chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  fi

  # Fix the shared Mosquitto config directory if it exists and is mounted.
  # The backend writes password_file and mosquitto.conf here for provisioning.
  MQTT_CONFIG_DIR="$(dirname "${MQTT_CONFIG_FILE:-/mosquitto/config/mosquitto.conf}")"
  if [ -d "$MQTT_CONFIG_DIR" ] && [ "$(stat -c '%U' "$MQTT_CONFIG_DIR")" != "$APP_USER" ]; then
    echo "aeolus-entrypoint: fixing ownership of $MQTT_CONFIG_DIR -> $APP_USER" >&2
    chown -R "$APP_USER:$APP_USER" "$MQTT_CONFIG_DIR"
  fi

  exec gosu "$APP_USER" "$@"
fi

exec "$@"
