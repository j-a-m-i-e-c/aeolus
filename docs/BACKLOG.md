# Aeolus — Review Remediation Backlog

Source: 3rd-party technical review (`dist/ai-convo.md`). Tracks how each
finding is being addressed across specs.

## Status legend
- ✅ Done
- 📋 Planned (identified, not yet specced)
- 🔁 Update to an existing spec
- 💬 Non-code / docs

---

## Completed

### unified-command-boundary ✅
One CommandService for all command sources, truthful result propagation,
AUTOMATION_FIRED (started) + AUTOMATION_COMPLETED (outcome) semantics,
manual /fire awaits, single Execution_Owner, architecture tests.

### command-completion-tier ✅
Author-selectable tier per automation (dispatch/acknowledged/observed),
always available under Advanced options, per-call override in scripts.
No device-level config needed — tier control lives entirely in automation code.

### Microcontroller ack protocol docs ✅
Documented the correlation envelope, response topic, ESP32 example,
and when to use each tier in `docs/MICROCONTROLLERS.md`.

---

## P0 — core truthful execution

### Sandbox async execution ✅
The `automation()` helper now awaits each action in order with fail-fast
semantics (stops on first failure unless `continueOnFailure` is set).
`Sandbox.execute()` drains all in-flight action promises via a two-stage
bounded completion wait before resolving, ensuring command results are no
longer lost. Implemented in the verified-command-execution spec (Task 15).

### Register-before-dispatch race ✅
`CommandService.execute()` now registers the pending command BEFORE dispatch;
`PendingCommandTracker.cancel()` settles the promise on dispatch failure.
Fast device acks are no longer dropped. Implemented in the
verified-command-execution spec (Task 16).

### End-to-end ack integration test ✅
Integration test (`src/__integration__/command-ack-flow.integration.test.ts`)
proves the full command → firmware ack → ACKNOWLEDGED flow through the real
MqttService ack-routing path with a simulated device, plus TIMED_OUT on no
reply. Implemented in the verified-command-execution spec (Task 17).

---

## P1 — reliability & security

### State provenance and observation 📋
Generic DeviceStateObservation envelope across all connectors (not just MQTT).
State provenance: origin = device | optimistic | synthetic. Only device-origin
satisfies physical confirmation. Prevents dangerous chained automations from
optimistic predictions.

### Execution concurrency policy ✅
ExecutionGate enforces a global max active executions cap (default 10),
per-rule FIFO queues with configurable depth (default 3), drop-on-overflow
with warn logging, and duplicate suppression (same rule + deviceId + topic).
Exposed on /api/health. Implemented as a pure module integrated into
AutomationEngine.

### Migration integrity 🔁
Update to `versioned-db-migrations`. Run FK/schema postcondition checks INSIDE
the migration transaction before the record + commit. Also: validate full
baseline on legacy adoption, don't assign DB singleton before migration
completes, take checkpoint before mutation.

### RBAC resource-level 📋
Move toward site/resource-scoped permissions (devices, automations, datasets)
rather than tab-attached. Server-side resource ownership checks. Blocker for
commercial multi-user; not urgent for single trusted deployment.

---

## Lower priority

- ~~First-admin race: two concurrent setup requests can both create initial admins~~ ✅
- ~~WebSocket token in query string: may be captured in reverse-proxy/access logs~~ ✅
- ~~Refresh cookie hardening: make production secure-cookie behavior explicit~~ ✅
- Execution history in memory: command + automation audit history lost on restart
- Pending commands lost on restart: cannot reconcile commands interrupted by process restart
- Prometheus cardinality: user-defined rule/collection names as labels → unbounded series
- ~~Docker reproducibility: floating Node 22, npm install vs npm ci, copying .git, root execution~~ ✅
- Monaco lazy-loading: ~6MB worker should load only when editor opens
- Script HTTP SSRF: arbitrary HTTP from scripts enables access to local network services
- Documentation truthfulness pass: update docs to match current implementation

---

## Optional enhancements (not from review)

- Live lifecycle progress streaming: per-transition WebSocket events so the UI
  can animate commands stepping through REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED
  in real time (~2-4 hours of work; cosmetic, not blocking)
