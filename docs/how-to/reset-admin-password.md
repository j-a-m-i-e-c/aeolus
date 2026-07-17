# Reset the admin password

Aeolus does not currently provide a second-admin or email-recovery flow. If the first-run administrator is lost, recovery requires resetting the user records in SQLite.

This deletes dashboard users, not devices, automations, connectors, layouts, groups or MQTT credentials.

## 1. Stop the backend

```bash
docker compose stop backend
```

For a direct development install, stop `npm run dev`.

## 2. Back up the database

For Docker on Linux, find the host path mounted at `/app/data`:

```bash
DB_DIR=$(docker inspect aeolus-backend \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}')

sudo cp "$DB_DIR/aeolus.db" "$DB_DIR/aeolus.db.before-admin-reset"
```

For a direct install, copy the file configured by `DB_PATH`, normally `data/aeolus.db`.

## 3. Delete user sessions and accounts

Using the host `sqlite3` command:

```bash
sudo sqlite3 "$DB_DIR/aeolus.db" \
  "DELETE FROM refresh_tokens; DELETE FROM users;"
```

For a direct install:

```bash
sqlite3 data/aeolus.db \
  "DELETE FROM refresh_tokens; DELETE FROM users;"
```

## 4. Restart Aeolus

```bash
docker compose start backend
```

Open the dashboard. The first-run setup page appears again.

## What is preserved

- groups and tab assignments;
- tabs and panes;
- automations and automation state;
- devices and history;
- connectors;
- Data Store content;
- MQTT credentials.

Normal user accounts must be recreated and assigned back to their groups.

Do not perform this procedure without a database backup.
