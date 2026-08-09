# Data and storage

Aeolus keeps its runtime state on the local installation.

## SQLite

The backend uses `better-sqlite3`. The default path is:

```text
./data/aeolus.db
```

Docker stores the database in the `backend_data` volume.

Core tables cover:

- devices;
- automation rules and automation state;
- dashboard tabs and panes;
- connectors;
- device history;
- durable command history (`command_records` and `command_transitions`);
- users, groups and refresh tokens;
- MQTT credentials and system settings;
- schema migration history.

Generic MQTT devices may carry an optional `mqtt_command_profile` (a validated
JSON column on the device row) describing acknowledgement capability and QoS;
see [Automations](automations.md) and [Microcontrollers](../MICROCONTROLLERS.md).
`command_records` holds one durable summary per verified command (keyed by
`command_id`, with `terminal_at` authoritative for completeness) and
`command_transitions` is an append-only lifecycle timeline.

The Data Store creates its own configuration, collection, record and bucket tables when initialised.

## Migrations

Versioned migrations live in:

```text
src/db/migrations/
```

The migration runner:

1. creates the migration history table;
2. validates migration IDs;
3. detects pending migrations;
4. refuses to run an older binary against a newer schema;
5. checkpoints the WAL and creates a pre-migration backup;
6. applies each migration transactionally;
7. restores foreign-key enforcement;
8. retains a bounded set of checkpoints.

Fresh and legacy databases use the same migration path.

## Device registry

The device registry loads persisted device records at startup and keeps the current in-memory view used by the API and automations.

Updates arrive through the internal event bus. Registry records contain the latest state, integration and last-seen time.

## Device state history

`StateHistory` stores bounded snapshots for trend views.

Configuration:

| Variable | Default | Purpose |
|---|---:|---|
| `STATE_HISTORY_MAX` | `100` | Maximum retained history entries per device |
| `HISTORY_RECORD_INTERVAL` | `5000` | Minimum interval between stored snapshots in milliseconds |

These variables are shown in `.env.example` and are read by the backend configuration.

## Automation state

Each automation has a private key-value namespace stored in `automation_state`.

Logic uses synchronous `state.get()` and `state.set()` calls inside the sandbox. State changes are pushed to the paired UI over WebSocket.

## Data Store

The Data Store provides two storage styles.

### Collections

Time-series records with:

- timestamp;
- JSON data;
- optional tags;
- retention and capacity settings.

Collections support time-range queries, filtering and CSV or JSON export.

### Buckets

Persistent key-value storage for application data that is not naturally a time series.

A bucket is useful for:

- calibration values;
- counters;
- user preferences;
- last processed identifiers;
- small lookup tables.

## Retention and safeguards

The Data Store is disabled until configured. It supports:

- global size limits;
- per-collection capacity;
- age-based retention;
- FIFO eviction;
- periodic cleanup;
- usage statistics.

## Backups

A useful Aeolus backup must include:

- the SQLite database;
- Mosquitto data and configuration where broker-managed credentials matter;
- deployment configuration and secrets;
- any externally stored custom assets.

See [Production deployment](../production-deployment.md) for commands and recovery guidance.
