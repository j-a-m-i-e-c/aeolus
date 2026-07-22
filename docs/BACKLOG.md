# Aeolus — In Progress Backlog
## Threat model

Aeolus targets small, local-first deployments — a household, farm, or single
site with a handful of mostly-trusted users — not large multi-tenant SaaS with
thousands of untrusted accounts. The security work below is about making the
permission features Aeolus advertises (groups, tabs, roles) actually hold, and
preventing accidental cross-user data exposure and truthfulness violations
(e.g. forged acknowledgements) — not about defending a hostile public-internet
surface. Priorities follow accordingly: correctness of the advertised
authorization model first, hardening against determined insiders second.

## Status legend
- 🔴 Critical — fix before describing the system as multi-user/secure
- 🟠 High — deployment/lifecycle correctness
- 🟡 Medium — clarity/reproducibility
- 📋 Planned — identified, not yet specced
- ✅ Done

---

## 🔴 Critical — authorization & security boundary

### WebSocket visibility fails open 🔴
Broadcast filtering sends any event lacking a `tabId` to every authenticated
client, so security depends on every producer decorating every sensitive
event. One missed field is a data leak. The behaviour is currently locked in
by tests.

Fix: invert to fail-closed. Unscoped events become admin-only or explicitly
public; resource events carry a server-derived authorization scope; the WS
server filters on resource identity, not an optional payload property. Model:
`BroadcastEnvelope = { visibility: "public" | "admin" } | { visibility: "tabs"; tabIds: string[] }`.

### Confine raw MQTT publishing to a user namespace 🔴
`POST /publish` lets an `interact` user publish an arbitrary topic + payload,
bypassing the command lifecycle and connector validation. For a trusted-user
deployment the realistic risk is less "malicious attacker" and more accidental
or curious cross-tab device operation — plus one genuine truthfulness footgun:
a user could publish to `aeolus/acks/#` and forge a device acknowledgement,
making a command look confirmed when the device never acted.

Fix (namespace partitioning, not a blanket admin lock):
- Confine `interact`-user publishes to a reserved user namespace, e.g.
  `aeolus/pub/#`; anything outside it → 403. This keeps raw publish useful
  (users can drive automations that deliberately listen on `aeolus/pub/#`)
  while making user-originated traffic unambiguous to humans, automations, and
  future broker ACLs.
- Always deny reserved system namespaces regardless of role — `aeolus/acks/#`
  (forged acks) and any command namespace — as a denylist that cannot overlap
  the allow-prefix.
- Admins may publish outside the user namespace (advanced diagnostic), still
  subject to the system-namespace denylist.
- Guardrails on every publish: maximum payload size; reject the `retain` flag
  for non-admins (prevents planting a persistent fake state).

Bonus: the predictable `aeolus/pub/` prefix makes broker-level ACLs trivial
later (device credentials get `aeolus/pub/#` and nothing else), dovetailing
with the MQTT broker hardening item below.

---

## 🟠 High — deployment & lifecycle correctness

### Prove MQTT provisioning against the real broker 🟠
The broker mounts `mosquitto.conf` but the backend only mounts its own data
volume. If provisioning writes broker config/password files into the backend
container, Mosquitto never sees them, and there is no reliable reload path.

Fix: one shared config volume mounted into both containers; a controlled
reload mechanism (sidecar, scoped signal, or orchestrated restart / generate-
before-start). Add an integration test connecting directly to Mosquitto that
verifies anonymous access is rejected, valid backend credentials work, device
credentials survive a backend restart, and revoked credentials stop working.

### Connector multi-instance ownership & registration 🟠
Action/condition handlers are globally keyed by type while connector instances
are independently enabled/disabled. Two instances of the same connector (two
Hue bridges, two Kasa networks) can overwrite each other's handlers, and
disabling one can unregister functionality the other still needs.

Fix: namespace contributions by `connectorType + connectorInstanceId + actionType`
(or a connector-level router resolving the owning instance at execution time).
Device ownership must include `connectorInstanceId`, not just the type. Add a
lifecycle integration test: two instances, discover + operate both, disable one,
verify the other still works and keeps its devices.

### Frontend/backend permission alignment 🟠
Ordinary non-admin UI device/automation calls are not consistently designed
around supplying a tabId, so legitimate actions can 403 while hand-crafted
requests pass with an unrelated permitted tab. Resolved as a side effect of
moving the permission boundary onto resources (addressed by the
resource-level-authorization spec, now in progress).

---

## 🟡 Medium — clarity & reproducibility

### Expressive HTTP status codes for command outcomes 🟡
The device action route returns 200 for all outcomes (including failure,
timeout, rejection). Map: 200 success / 202 accepted-async / 409|422 rejected /
504 timeout / 502|503 transport unavailable — keeping the lifecycle object as
the authoritative detail. Not a blocker, but reviewers question why timeouts
look like successful HTTP calls.

### Remove the all-devices grid pane from the operator UI 🟡
The `device-grid` ("all devices") pane dumps every device onto one surface.
Operators should get purpose-built views, not a raw device list, and the
resource-authorization work already treats `device-grid` as non-exposing for
non-admins (only `hue-control` / `kasa-control` / `sensor-panel` grant access).
Remove the pane from the product: delete the component, drop it from the pane
registry and config panel, and add a layout migration so existing layouts
containing a `device-grid` pane don't render a broken/empty tile. Backend
authorization does not depend on this (device-grid is already non-exposing), so
this is UI cleanup + defense-in-depth, not a security fix.

### Remove the dead "Room Filter" pane config 🟡
`PaneConfigPanel.tsx` offers a "Room Filter" input that writes `config.room` for
`device-grid` / `sensor-panel` panes, but the backend `Device` model has no room
attribute, so the filter matches nothing. "Room" also doesn't fit the platform's
general (non-home-automation) positioning. Remove the Room Filter input and the
`config.room` field (and any references) so users can't configure a filter that
does nothing.

---

## 📋 Planned — authoring safety & portability

### Automation deletion is unrecoverable 📋
Deleting an automation is an immediate hard delete (`DELETE FROM automation_rules`)
that also wipes its stored state and unregisters it from the engine. There is no
confirmation, soft-delete, or undo, so a single misclick permanently destroys
hand-written script and paired UI. Add a safety margin: soft-delete or
archive-on-delete so a removed automation can be restored; a confirmation before
destroying authored logic/UI; and retention of the rule's state until deletion is
finalised.

### Export and import individual automations 📋
Allow a single automation — its logic, paired UI, trigger configuration and
metadata — to be exported to a portable file and imported into another
installation or kept as an off-system backup. This is the lightweight,
per-automation companion to the roadmap's "Reusable Aeolus applications" (which
packages a curated Logic/UI pair for distribution), and it gives authored work a
durable home outside the database, complementing the deletion-recoverability item
above.

---
## Testing

### Adversarial end-to-end tests with a real non-admin user 📋
Prove the resource-authorization model holds: a non-admin attempts to act on a
device/automation outside their tab scope and is rejected (403); legitimate
in-scope actions succeed. Blocked on the resource-level-authorization spec (now
in progress).

---

## Still open from the prior review

- State provenance and observation 📋 — generic DeviceStateObservation envelope
  across all connectors; origin = device | optimistic | synthetic; only
  device-origin satisfies physical confirmation.
- Pending commands lost on restart — cannot reconcile commands interrupted by a
  process restart (in-memory tracker; documented limitation).
- Documentation truthfulness pass — keep reference docs matching implementation.

---

## Optional enhancements (not from review)

- Live lifecycle progress streaming: per-transition WebSocket events so the UI
  can animate REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED in real time
  (cosmetic, not blocking).

---

_Completed work is recorded in git history (see `git log`)._
