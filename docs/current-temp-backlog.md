# Aeolus — Third-Party Review Remediation Backlog

Source: 3rd-party technical review in `dist/ai-convo.md`. This tracks how each
finding is being addressed across specs. Keep updated as specs progress.

## Status legend
- ✅ Specced (requirements + design + tasks complete)
- 🚧 In progress / partially specced
- 📋 Planned (identified, not yet specced)
- 🔁 Update to an existing spec
- 💬 Non-code / docs

---

## P0 — core "truthful execution" thread

### P0 #2 + #3 — Unified command boundary + truthful result propagation
- Status: ✅ Specced as `unified-command-boundary` (ready to execute).
- Covers: one CommandService boundary all sources route through; AutomationExecutionResult;
  AUTOMATION_FIRED (started) + AUTOMATION_COMPLETED (outcome); manual /fire awaits; single Execution_Owner.
- Also resolved here: truthful REST / aeolus.control() result (was a custom-ui-sandboxing concern).

### P0 #1 — No built-in device can currently reach ACKNOWLEDGED
- Status: 🔁 Planned — update to `verified-command-execution`.
- Gap: the ack-capability interface + MQTT correlation exist, but no concrete built-in
  connector (real MQTT firmware path) implements getAcknowledgementCapability. Add a real,
  end-to-end ack-capable MQTT connector path so ACKNOWLEDGED is reachable in production, not just tests.

### P0 #4 — Async actions in scripts are not awaited
- Status: 📋 Planned — new spec (proposed: `sandbox-async-execution`).
- The generated automation() helper doesn't await device actions, so sandbox "success" only
  means the sync body didn't throw. Make the helper async/await actions; decide fail-fast vs
  continueOnFailure; resolve the top-level-await vs isolated-vm compilation concern.
- NOTE: unified-command-boundary's script-path truthfulness (Req 5.3) depends on this fix.

### P0 #5 — Register-after-dispatch race
- Status: 🔁 Planned — update to `verified-command-execution`.
- Correct ordering: create correlationId → register pending command → dispatch → cancel on
  dispatch failure → await resolution. Prevents fast device replies being discarded as unknown.

---

## P1 — reliability & security

### Observation only works for MQTT state (connector-generic observation)
- Status: 📋 Planned — new spec (proposed: `state-provenance-and-observation`).
- Make observation consume a standard DeviceStateObservation envelope from ALL connectors,
  not just the MQTT ingestion path. Consider requireTransition, observation-after-dispatch,
  stability duration, min readings, sequence IDs.

### Optimistic connector state treated as factual
- Status: 📋 Planned — same spec as above (`state-provenance-and-observation`).
- Add state provenance (origin: device | optimistic | synthetic). Only origin:"device" may
  satisfy physical confirmation. Optimistic state may show in UI but must not be recorded/consumed
  as an observed physical fact (prevents dangerous chained automations).

### No command / automation concurrency policy
- Status: 📋 Planned — new spec (proposed: `execution-concurrency-policy`).
- Per-rule policy (drop | queue | restart | parallel), per-device command serialization,
  global max active executions, queue depth limits, duplicate suppression / idempotency keys,
  conflict resolution. Reliability + resource protection on Raspberry Pi.

### MQTT dispatch fire-and-forget at broker level
- Status: ✅ Covered by `verified-command-execution` (Broker_Acceptance via publish callback, QoS 1).

### Migration integrity checking happens too late
- Status: 🔁 Planned — update to `versioned-db-migrations`.
- Run FK/schema postcondition checks INSIDE the migration transaction, before the migration
  record + commit. Also: validate full baseline on legacy adoption (not just one key table);
  don't assign the DB singleton before migration completes / reset on failure; take the
  checkpoint before any migration-history mutation.

### RBAC is presentation-level, not resource-level
- Status: 🔁 Planned — update to `authentication` (confirm scope first).
- Move toward site/resource-scoped permissions (devices, automations, datasets) rather than
  tab-attached permissions. Server-side resource ownership checks, not client-provided tabId.
  Blocker for commercial multi-user; not urgent for single trusted deployment.

### Frontend iframe isolated but highly privileged
- Status: 🚧 Mostly covered by `custom-ui-sandboxing` (capability-scoped SDK, trust boundary,
  trusted/untrusted mode). aeolus.control() truthful result now handled in unified-command-boundary.
- Remaining (future): a capability manifest for least-privilege (marketplace / Untrusted_Mode) —
  app declares which devices it may read/control and which topics it may publish.

---

## Author-selectable completion tier
- Status: 🚧 Being specced now as `command-completion-tier`.
- Builds on the requiredTier input exposed by unified-command-boundary's design. Adds: persistence
  of the chosen tier per rule, authoring UI (showing which tiers the device can prove), and wiring
  the stored tier through the form/script paths. Tier-selection mechanism itself lives in
  verified-command-execution.

---

## Lower-priority / smaller items (mostly unspecced)

- Sandbox pool eviction: evicted iframe can leave a mounted pane "ready" with no iframe and no
  recreation trigger. (→ custom-ui-sandboxing or runtime-custom-ui)
- First-admin race: two concurrent setup requests can both create initial admins. (→ authentication)
- WebSocket token in query string: may be captured in reverse-proxy/access logs. (→ authentication)
- Refresh cookie hardening: make production secure-cookie behavior explicit. (→ authentication)
- Execution history is in memory: command + automation audit history lost on restart. (→ new/observability)
- Pending commands lost on restart: cannot reconcile commands interrupted by process restart.
  (→ verified-command-execution follow-up)
- Prometheus cardinality: user-defined rule/collection names as labels → unbounded series.
  (→ observability-metrics)
- Docker reproducibility: floating Node 22, npm install vs npm ci, dep-engine mismatch, copying
  .git, compiler tooling in prod image, root execution. (→ new hardening/build spec)
- Host-network deployment: expands network exposure; practical for discovery — likely accept + document.
- Frontend bundle: Monaco (~6MB worker) should be lazy-loaded only when an editor opens. (→ performance)
- Automation HTTP access: arbitrary HTTP from scripts enables SSRF / local-network access — safe only
  when scripts are trusted or destinations constrained. (→ security follow-up)

---

## Documentation truthfulness pass (💬)
- Docs overclaim in two places: "both sides run in sandboxes" (frontend isn't yet, until
  custom-ui-sandboxing lands) and "verified command execution" (not wired through every path until
  unified-command-boundary lands). Do a docs pass once the convergence specs are implemented.

---

## MQTT broker provisioning gap (deployment integration)

### UI-driven Mosquitto credential management does not work in default Docker setup
- Status: 📋 Planned — new spec (proposed: `mqtt-broker-provisioning`).
- **Problem:** The backend has code to manage Mosquitto users/passwords (shared mode and
  per-device mode), but in the default Docker Compose deployment the backend container cannot
  access Mosquitto's config/password files or signal Mosquitto to reload. The backend writes
  config inside its own container where Mosquitto never sees it, and lacks Docker socket access
  to send SIGHUP.
- **Impact:** Affects ALL authenticated MQTT modes (Shared password AND Per-device passwords).
  Open/anonymous mode works fine. Normal MQTT communication (telemetry, commands, automations)
  is unaffected — only the UI-driven credential provisioning is broken.
- **Dangerous UX:** The dashboard currently lets users switch security modes and implies the
  change succeeded, when in reality Mosquitto remains in its previous state (likely anonymous).
  This is a security misrepresentation.
- **Immediate mitigation (no spec needed):**
  - Detect at runtime whether provisioning is actually available (can we write the config? can
    we signal the broker?).
  - If unavailable, disable the security-mode UI and show a clear message:
    _"Broker provisioning is unavailable in this deployment. MQTT credentials must be configured
    manually."_
  - Do NOT let the user switch modes when provisioning will silently fail.
- **Long-term fix — provisioning sidecar:**
  ```
  Aeolus backend
        ↓ restricted API call
  Mosquitto provisioning helper (sidecar container)
        ↓ shared volume
  Mosquitto config + password files
        ↓ SIGHUP
  Mosquitto broker reload
  ```
  The sidecar has access to the shared Mosquitto config volume and can signal the broker. It
  exposes a narrow API (write password file, update config, reload broker) — no general Docker
  access. The backend never gets the Docker socket.
- **Why not just mount Docker socket into the backend:** Grants near-root host control. Not
  acceptable as a default.
- **Interim manual workflow:** Configure Mosquitto users by editing `./mosquitto/mosquitto.conf`
  and the password file directly on the host, then restart the Mosquitto container. Use Aeolus
  normally for device communication; treat dashboard MQTT-user provisioning as unavailable until
  the sidecar is implemented.
