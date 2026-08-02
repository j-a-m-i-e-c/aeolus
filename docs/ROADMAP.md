# Aeolus roadmap

The roadmap is organised by horizon rather than by every idea that has ever come up. Completed design notes remain in Git history and `.kiro/specs/`; this file is for work that may still shape the product.

## Now

### Make the common command path boring and dependable

Finish converging dashboard controls, custom UI, REST calls and automation actions on the same result-aware command service.

The goal is consistent behaviour regardless of where a command starts:

- one result model;
- clear dispatch, acknowledgement and observation semantics;
- useful audit history;
- sensible handling of conflicting or overlapping commands.

An earlier 2 Aug 2026 review found the command composition itself was mis-routing
REST/dashboard/custom-UI device actions (source tags read as automation IDs,
native actions with no generic handler, MQTT dispatch never wired in, a divergent
brightness contract). That breakage is now fixed — the command source is an
explicit discriminated union, MQTT dispatch is wired at composition, and
brightness has one canonical contract. The convergence goal here builds on that
fixed foundation.

A follow-up review then found the remaining pre-promotion risk sits in the
bundled Hue and Kasa connectors, which had drifted from the newer, stricter
Action Catalog and multi-instance contracts (advertised controls that are
rejected or executed incorrectly, a Kasa discovery listener leak, and non-unique
device IDs). That connector-correctness work is the active pre-promotion connector
gate, tracked in the `connector-correctness-release-gates` spec (`.kiro/specs/`).

### Prove Aeolus on real equipment

Turn the Koonorigan installation into a strong reference deployment using real sensors, water, energy and shed infrastructure.

The important output is not another simulated dashboard. It is a documented system that runs every day, survives restarts and makes failures easy to understand.

### Improve first-run and authoring experience

Reduce the distance between:

```text
clone repository
```

and:

```text
working local application with live data
```

This includes better examples, clearer connector setup, useful snippets and finished screenshots/GIFs.

### Keep operations repeatable

Continue improving:

- backup and restore checks;
- migration and upgrade tests;
- process restart behaviour;
- production packaging;
- documentation that matches the code.

## Next

### Modbus and distributed energy

Add a practical Modbus path for inverters, meters, VFDs, PLCs and building equipment.

A Deye or compatible energy integration is the likely first proving case. Read-only telemetry should come before control writes.

### Reusable Aeolus applications

Package a Logic/UI pair, metadata, required capabilities and setup information as an exportable application unit.

This should make it possible to move an application between installations without turning the project into a marketplace before the trust and permission model is ready.

### Better device provisioning

Keep zero-friction discovery for development, while adding optional stricter operation:

- pending-device approval;
- allowlists;
- tags and groups;
- credential assignment;
- visible firmware and version metadata.

### Explore a power-user role

Investigate whether a middle tier between `user` and `admin` is worth its cost.

Today the two roles split cleanly into "governs the system" (admin) and "uses the system" (user). A power user would sit between them: elevated *operational and visibility* reach — building dashboards and automations, publishing more freely, removing private topic filters, broader real-time visibility — without any authority over *identity, access grants or MQTT credentials*, which must stay with admins so the tab boundary keeps meaning.

Points to weigh before committing:

- whether a fixed tier or per-group capability grants (e.g. manage layout, publish anywhere) fit a small, mostly-trusted deployment better;
- the migration and middleware cost of a role hierarchy (`admin > power > user`) versus flat admin checks;
- keeping the single-node, few-users experience simple rather than modelling a permission system the deployments do not need.

### Stronger state provenance

Make it easier to distinguish:

- a device observation;
- an optimistic UI update;
- derived state;
- stale state;
- a command result.

This improves both automations and operator trust.

### Load and failure testing

Extend the existing unit, property, integration and Playwright coverage with repeatable scenarios such as:

- many devices publishing together;
- broker disconnection during execution;
- connector timeouts;
- restart during a pending action;
- storage pressure and retention cleanup.

## Later

### Fleet and multi-node tooling

Possible capabilities include:

- installation identity and health;
- remote diagnostics;
- staged upgrades;
- configuration backup;
- application deployment;
- multi-site views.

The local node should remain useful without the fleet service.

### More connectors and transports

Potential integrations include:

- Shelly and Tasmota;
- Zigbee through a local coordinator or zigbee2mqtt;
- Z-Wave;
- Art-Net, sACN or OLA for stage control;
- BLE and LoRa gateways;
- local camera and inference services.

New connectors should be driven by real deployments rather than connector count.

### Visual helpers alongside code

Improve flow views, trigger builders and reusable snippets without making a generated diagram the only editable source.

Code remains available for the cases that need it.

### Local inference

Treat local computer vision and small on-device models as normal event sources.

Possible uses include workshop safety, wildlife observation, equipment monitoring and visual inspection. Inference should remain optional and should not redefine Aeolus as an AI product.

### High availability and larger deployments

Clustering, external queues and larger time-series systems only make sense when installations exceed the current single-node edge model.

The Raspberry Pi and small-site experience should not be made worse to solve a scale problem that has not appeared.

## Completed foundations

The platform already includes:

- local MQTT ingestion and device discovery;
- Hue and Kasa connectors;
- free-form Logic and form rules;
- paired sandboxed React UI;
- persistent automation state;
- Data Store collections and buckets;
- authentication, groups and the MQTT provisioning framework;
- versioned SQLite migrations and checkpoints;
- logs, metrics, history and health views;
- backend, frontend, integration and Playwright testing;
- Docker Compose and Raspberry Pi deployment support;
- command lifecycle framework for dispatch, acknowledgement and observation.

Completed does not mean finished forever. It means future work should build on these foundations rather than describe them as missing.
