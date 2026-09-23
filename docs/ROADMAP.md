# Aeolus roadmap

The roadmap is organised by horizon rather than by every idea that has ever come up. This file is for work that may still shape the product, not a record of everything already delivered.

## Now

### Make the common command path boring and dependable

Finish converging dashboard controls, custom UI, REST calls and automation actions on the same result-aware command service.

The goal is consistent behaviour regardless of where a command starts:

* one result model;
* clear dispatch, acknowledgement and observation semantics;
* useful audit history;
* sensible handling of conflicting or overlapping commands.

An earlier 2 Aug 2026 review found the command composition itself was mis-routing
REST/dashboard/custom-UI device actions (source tags read as automation IDs,
native actions with no generic handler, MQTT dispatch never wired in, a divergent
brightness contract). That breakage is now fixed. The command source is an
explicit discriminated union, MQTT dispatch is wired at composition, and
brightness has one canonical contract. The convergence goal here builds on that
fixed foundation.

A follow-up review then found the remaining pre-promotion risk had moved into the
bundled Hue and Kasa connectors, which had drifted from the newer, stricter
Action Catalog and multi-instance contracts (advertised controls that were
rejected or executed incorrectly, a Kasa discovery listener leak, and non-unique
device IDs). That connector-correctness work is now complete. The remaining
convergence work here builds on those fixed connectors.

### Prove Aeolus on real equipment

Turn the Koonorigan installation into a strong reference deployment using real sensors, water, energy and shed infrastructure.

The important output is not another simulated dashboard. It is a documented system that runs every day, survives restarts and makes failures easy to understand.

### Improve first run and authoring experience

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

* backup and restore checks;
* migration and upgrade tests;
* process restart behaviour;
* production packaging;
* documentation that matches the code.

## Next

### Modbus and distributed energy

Add a practical Modbus path for inverters, meters, VFDs, PLCs and building equipment.

A Deye or compatible energy integration is the likely first proving case. Read only telemetry should come before control writes.

### Reusable Aeolus applications

Package a Logic/UI pair, metadata, required capabilities and setup information as an exportable application unit.

This should make it possible to move an application between installations without turning the project into a marketplace before the trust and permission model is ready.

### Published APIs

Let an Automation Project deliberately publish a narrow HTTP interface for selected data and capabilities, without requiring the author to run another web service or rebuild authentication, TLS, rate limiting and auditing from scratch.

The platform should own the HTTP server and route requests into sandboxed automation handlers. Automation code should never open its own listening ports. A first version should stay intentionally small:

* JSON request and response handlers for common HTTP methods;
* local-only exposure by default, with remote exposure as an explicit choice;
* scoped API credentials that can be limited to specific routes and methods;
* request size, timeout and rate limits at the platform boundary;
* audit history for external calls, especially routes that can cause physical actions;
* physical commands continuing through the normal Command Service and Command Evidence path rather than bypassing Aeolus;
* generated OpenAPI metadata where the route declaration already contains enough schema information.

The goal is not to turn Aeolus into a generic API gateway. It is to make edge applications easy to integrate with other software while preserving the same security and truthful command semantics as the dashboard and automation runtime.

### Better device provisioning

Keep low friction discovery for development, while adding optional stricter operation:

* pending-device approval;
* allowlists;
* tags and groups;
* credential assignment;
* visible firmware and version metadata.

### Explore a power-user role

Investigate whether a middle tier between `user` and `admin` is worth its cost.

Today the two roles split cleanly into "governs the system" (admin) and "uses the system" (user). A power user would sit between them: elevated *operational and visibility* reach for building dashboards and automations, publishing more freely, removing private topic filters and gaining broader real time visibility, without any authority over *identity, access grants or MQTT credentials*, which must stay with admins so the tab boundary keeps meaning.

Points to weigh before committing:

* whether a fixed tier or per-group capability grants (e.g. manage layout, publish anywhere) fit a small, mostly trusted deployment better;
* the migration and middleware cost of a role hierarchy (`admin > power > user`) versus flat admin checks;
* keeping the single node, few users experience simple rather than modelling a permission system the deployments do not need.

### Stronger state provenance

Make it easier to distinguish:

* a device observation;
* an optimistic UI update;
* derived state;
* stale state;
* a command result.

This improves both automations and operator trust.

### Load and failure testing

Extend the existing unit, property, integration and Playwright coverage with repeatable scenarios such as:

* many devices publishing together;
* broker disconnection during execution;
* connector timeouts;
* restart during a pending action;
* storage pressure and retention cleanup.

## Later

### Aeolus federation and multi-site systems

Allow independent Aeolus installations to cooperate without making a central service part of their runtime dependency. Each site should remain authoritative for its own devices, automations and safety behaviour.

A future federation layer can build on the same secure transport and capability model as Published APIs, but should remain a distinct Aeolus-to-Aeolus protocol rather than raw MQTT bridging or shared administrator credentials. Possible capabilities include:

* stable installation identity, health and version discovery;
* machine credentials with explicit cross-site capabilities rather than full admin authority;
* selective publication of current state, discrete events and callable operations;
* remote state caching with latest-value semantics while occurrence events retain their event semantics;
* cross-site commands that preserve causation and Command Evidence across both nodes;
* multiple-site views, diagnostics, backups and staged application deployment;
* graceful offline behaviour where loss of the WAN link removes coordination but never stops local control.

The intended model is federation, not one cloud controller owning every node. A pump station, shed, laboratory or remote instrument should continue operating correctly when every other Aeolus deployment is unreachable.

### More connectors and transports

Potential integrations include:

* Shelly and Tasmota;
* Zigbee through a local coordinator or zigbee2mqtt;
* Z-Wave;
* Art-Net, sACN or OLA for stage control;
* BLE and LoRa gateways;
* local camera and inference services.

New connectors should be driven by real deployments rather than connector count.

### Visual helpers alongside code

Improve flow views, trigger builders and reusable snippets without making a generated diagram the only editable source.

Code remains available for the cases that need it.

### Local inference

Treat local computer vision and small on device models as normal event sources.

Possible uses include workshop safety, wildlife observation, equipment monitoring and visual inspection. Inference should remain optional and should not redefine Aeolus as an AI product.

### High availability and larger deployments

Clustering, external queues and larger time series systems only make sense when installations exceed the current single node edge model.

The Raspberry Pi and small site experience should not be made worse to solve a scale problem that has not appeared.

## Completed foundations

The platform already includes:

* local MQTT ingestion and device discovery;
* Hue and Kasa connectors;
* Automation Project Logic plus retained form-rule runtime compatibility;
* paired sandboxed React UI;
* persistent automation state;
* reactive Shared State and optional Data Store collections;
* authentication, groups and the MQTT provisioning framework;
* versioned SQLite migrations and checkpoints;
* logs, metrics, history and health views;
* backend, frontend, integration and Playwright testing;
* Docker Compose and Raspberry Pi deployment support;
* command lifecycle framework for dispatch, acknowledgement and observation.

Completed does not mean finished forever. It means future work should build on these foundations rather than describe them as missing.
