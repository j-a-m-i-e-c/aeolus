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

---

##  High — deployment & lifecycle correctness

### Verify MQTT provisioning applies to the real broker 🟠
Dashboard-managed Shared Password and Per-Device security are implemented and
gated behind `MQTT_MANAGED_PROVISIONING_ENABLED=true`. The remaining work is
proving the sidecar reload path: the backend must confirm Mosquitto has applied
a credential change before reporting success. Until that verification loop is
complete the feature stays disabled by default.

---

## 🟡 Medium — clarity & reproducibility

### Scope Data Store live events to tabs 🟡
`data-store-write` / `data-store-collection-deleted` WebSocket events are
broadcast to admins only, because there is no collection→tab authorization
model. Give collections a collection→tab scope so their live events can reach
non-admins on the tabs that surface them, instead of defaulting to admin-only.
This is the remaining follow-up from the fail-closed WebSocket visibility work;
device, automation and MQTT events are already scoped.

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
in-scope actions succeed. Resource-level authorization is shipped; these tests
can now be written.

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
