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

`command_records` also carries write-once snapshot columns, frozen at acceptance, that
let a command explain the evidence stages it never reached and name what triggered it:
the capability ceiling, acknowledgement availability, whether the command carried an
observation contract, the observing device and condition, the transport, both device
display names, the author's intent labels, and the trigger's kind, id and topic. All
are nullable with no backfill, so an absent value means *not recorded* rather than
`false`. See [Automations](automations.md) and
[ADR-0014](../adr/0014-fixed-command-proof-scaffold.md).

The Data Store creates its own configuration, collection and record tables when initialised. The Shared State table is created unconditionally, because Shared State is a core facility rather than part of optional historical storage.

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

## What stores what

Aeolus keeps five kinds of information, and each has one mechanism. Choosing between
them is the decision that matters; the rest of this page is mechanics.

| You have | It lives in | Because |
|---|---|---|
| Current truth about a device | Device State | Latest value matters; it comes from MQTT or a connector |
| Durable state private to one automation | Automation State | Nothing else should read it |
| Durable current value shared between automations | Shared State | Latest value matters, and a change can wake a consumer |
| Timestamped observations you want to query later | Data Store Collections | History matters, and it accumulates |
| Something happened | Automation Events | Every occurrence matters |

Shared State and Collections are separate facilities, not two modes of one store.
Shared State is always available; Collections are optional because unbounded history can
fill a constrained device. See [ADR-0016](../adr/0016-shared-state-and-automation-events.md).

## Automation state

Each automation has a private key-value namespace stored in `automation_state`.

Logic uses synchronous `state.get()` and `state.set()` calls inside the sandbox. State changes are pushed to the paired UI over WebSocket.

Writes are idempotent. `state.set()` with the value a key already holds performs no
SQLite write and sends no WebSocket broadcast, so a projection that recomputes the same
value on every device publish costs nothing. Change detection is exact serialized-JSON
equality, so two objects with the same entries in a different key order count as
different.

## Shared State

Durable current values that automations intentionally share. This is where one automation
tells the others what is true *now*.

```ts
shared.set("bunker-summary", "power", { battery, solar, load, net });

const power = shared.get("bunker-summary", "power");
shared.delete("bunker-summary", "power");
```

A **bucket** is a namespace inside Shared State. Entries survive a backend restart.

Four properties define it:

- **Always available.** Shared State does not wait on the historical Data Store being
  enabled. Disabling the Data Store removes Collections, not shared values.
- **Idempotent.** `set()` returns whether the stored value actually changed. An identical
  write performs no SQLite write, does not move `updated_at`, and triggers nothing.
- **Reactive.** A real change can wake automations using the `shared-state` trigger type
  with a `<bucket>/<key>` path pattern. Pending work for one key is coalesced
  keep-latest, because the durable value already holds the newest state. See
  [Automations](automations.md).
- **Internal.** Shared State is never published to MQTT, under any namespace.

It is **not history**. Writing 72, then 73, then 74 leaves 74 and no record of the
others. When you want both, write both:

```ts
shared.set("bunker-summary", "power", current);
db?.write("bunker-power-history", { battery: current.battery });
```

### Bounds

Shared State is small current state, not a document or blob store. It has its own limits
and is deliberately not governed by the Data Store's `maxStorageMb`:

| Bound | Value |
|---|---:|
| Serialized value size | 64 KiB |
| Bucket or key name length | 200 characters |
| Total entries | 5,000 |

Bucket and key names may not contain `/`, `+` or `#`, so one stored value has exactly one
unambiguous reactive path. A refused write throws rather than failing quietly, because a
silently dropped write would leave a consumer reading a stale value with no sign the
producer had tried to update it.

Entries are stored in the `ds_buckets` table, which keeps its name from when Shared State
lived inside the Data Store. That is a storage detail, not the product model.

### Access

Shared State is global and has no bucket-to-tab ownership model, so:

- unrestricted (admin-authored) automations may use `shared.*`;
- tab-scoped automations cannot reach it, and are not woken by changes to it;
- REST management under `/api/shared-state` is admin-only.

See [Permissions](../security/permissions.md).

### Deprecated aliases

`db.get()`, `db.set()` and `db.delete()` still read and write the same Shared State, and
`/api/data-store/buckets/*` still works. Both are deprecated: they are only present when
the historical Data Store is enabled, which has nothing to do with whether a shared
current value exists. Use `shared.*` and `/api/shared-state`.

## Data Store

The Data Store records historical observations in Collections.

### Collections

Time-series records with:

- timestamp;
- JSON data;
- optional tags;
- retention and capacity settings.

Collections support time-range queries, filtering and CSV or JSON export.

A record query is always bounded, so reading a collection cannot become an
unbounded scan. Time filtering is independent of pagination: visualising a range
and browsing raw records are separate queries, and the Data Explorer issues one
of each rather than charting the table's current page. Export is the deliberate
exception and reads the whole collection.

The two queries are also bounded differently, because they answer different
questions. A table page wants the newest rows, so it uses `limit` and `offset`. A
chart wants the shape of an interval, so it asks for `maxPoints` and the store
returns one stored record from each equal-width slice of the range — spread across
the whole window rather than clustered at its newest edge, and reporting the bucket
width it used so the chart can state the spacing it is drawing. The points remain
real observations; nothing is averaged into a value the site never recorded.

## Retention and safeguards

Historical Collections are disabled until configured, because history accumulates without
bound and a constrained edge device has to be told how much of it to keep. Shared State is
unaffected by this setting.

It supports:

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
