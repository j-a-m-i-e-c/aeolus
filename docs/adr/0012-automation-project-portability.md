# ADR-0012: Automation Project portability — packages, library projects and logical device binding

- **Status:** Proposed
- **Date:** 2026-09-06

## Context

ADR-0007 made an Automation Project a bounded multi-file tree compiled in memory
and persisted alongside the rule it belongs to. That works well for authoring on one
site and is deliberately narrow: `automation_projects.automation_id` is the primary
key, so a project **is** an automation. There is no project identity independent of a
running rule, no version, no provenance, and no way to have two instances of the same
project.

What exists today, verified rather than assumed:

- **Persistence.** `automation_projects` (1:1 with a rule) plus
  `automation_project_files` (flat `path → content`, PK `automation_id + path`).
  No name, version, manifest, hash or revision column. Deleting the rule cascades the
  tree away. Migration `015-automation-projects.ts`.
- **Bounds already exist and are enforced at compile time**
  (`src/automations/automation-project.ts`): 64 files, 512 KB total, 128 KB per file,
  an extension allowlist, and `normalizeProjectPath` rejecting absolute paths,
  backslashes, NUL bytes and any `..` escape. The import boundary allows relative
  specifiers only, plus four UI externals.
- **No transport.** There is no import or export endpoint, no upload middleware and
  no package format. The only ingestion path is a JSON body on
  `POST /api/automations` / `PUT /api/automations/:id/project`.
- **Device references are hard-coded topic literals.** Around 25 showcase projects
  each define the same `byTopic()` helper over `devices.list()`. There is no role,
  alias or binding indirection anywhere, which is precisely why these projects are
  not portable.
- **Capability requirements are expressible from two different materials.**
  `CapabilityDescriptor` + `ActionRouter.resolveActionCatalog` already make "this
  device supports action T with params P" machine-checkable, and the router
  pre-validates actions against it. There is no *declarative schema* for device state —
  it is an untyped `Record<string, unknown>` and `capabilities` is frequently `[]` for
  MQTT and simulated devices — but there is **observation**: `StateHistory`
  (`src/core/state-history.ts`) records state snapshots per device into
  `device_history(device_id, state, timestamp)`, capped at `STATE_HISTORY_MAX` (100)
  entries per device and throttled to one write per `HISTORY_RECORD_INTERVAL` (5 s).
  So "does this device report field Y" is answerable from evidence even though it is
  not answerable from a schema.
- **`AuthorizationScope` is already set-shaped.** `resolve()` returns
  `{ deviceIds, collections }` as sets, which means an additional narrowing filter
  composes with it without touching how it is derived.
- **Permissions are derived, not declared.** `AutomationScopeResolver` recomputes
  authority on every dispatch from `(authored_unrestricted, owner_tab_id, whatever
  the owning tab's panes currently expose)`. Nothing per-automation is stored that a
  manifest could be reconciled against.
- **Import would currently execute immediately.** Creating or updating a project
  compiles and calls `registerUiRule` in the same request, so there is no inert
  "present but not approved" state.
- **The pane catalogue is static.** `PANE_REGISTRY` is a compile-time object with a
  closed category union, `PanePicker` snapshots it at module scope, and the dashboard
  store *deletes* panes whose type is not in the registry. A dynamically registered
  pane type would be silently removed from saved layouts.

## Decision

Add portability as three concepts and one binding seam, reusing the existing compiler,
bounds and scope model rather than paralleling them.

### 1. Package format — bounded JSON, not an archive

A package is a single JSON document, conventionally `*.aeolus`:

```json
{
  "manifest": { "formatVersion": 1, "name": "Water Transfer", "...": "..." },
  "files": [{ "path": "logic/index.ts", "content": "…" }]
}
```

It is deliberately **not** a zip or tarball. The existing ingestion path is already a
bounded JSON body whose limits are expressed over exactly this shape, so a package can
be validated by `normalizeProject` unchanged. An archive would add decompression
bombs, entry-name traversal, and a second path-normalisation implementation to keep in
step with the first — three new failure modes to move the same bytes.

Export is the inverse: the stored tree plus the manifest. Never exported: automation
state, Data Store history, device ids, bindings, credentials, connector
configuration, `demo_access`, or anything from `automation_rules` beyond the authored
tree and the trigger suggestion.

### 2. Manifest — declares identity, requirements and intent

`aeolus.project.json`, carried in the package and persisted with the library row:

```json
{
  "formatVersion": 1,
  "name": "Water Transfer",
  "version": "1.2.0",
  "description": "Maintains header storage from a source tank",
  "logicEntry": "logic/index.ts",
  "uiEntry": "ui/index.tsx",
  "trigger": { "type": "mqtt", "topic": "sensor/+/header-tank" },
  "requires": {
    "devices": {
      "transferPump": { "label": "Transfer pump", "actions": ["command"], "reads": ["on"] },
      "flowMeter":    { "label": "Flow meter",    "reads": ["litresPerMinute"] }
    }
  },
  "permissions": {
    "dataStore": { "write": ["tank-history"] }
  }
}
```

`trigger` is a **suggestion** shown at install, not a grant: a package that could
silently bind itself to a topic would be choosing its own activation condition.

`permissions` declares only the dimensions `AuthorizationScope` actually carries —
devices (through the roles in `requires`) and Data Store collections. Both are sets of
ids, which is what makes the intersection in §5a total. A field that could not be
enforced would be a field that looks load-bearing and is not, so there deliberately isn't
one: no raw-MQTT topic patterns, no event namespaces. Adding either means giving scope a
new dimension first, which §"Revisit when" treats as its own decision.

### 3. Logical device binding — the seam that makes a project portable

The manifest names roles; Logic resolves them through a new accessor rather than a
topic literal:

```ts
const pump = devices.role("transferPump");
const flow = devices.role("flowMeter");
```

Bindings are per installed automation, stored in a new
`automation_device_bindings(automation_id, role, device_id)`. `devices.role()`
resolves through the **existing scope filter**: a role bound to a device outside the
automation's authorization scope resolves to `undefined`, exactly as
`devices.get()` on an unexposed device already does. A binding therefore narrows
within authority and can never widen it.

Both kinds of requirement are checked at bind time, each against the material that can
actually settle it:

- `actions` are verified against the device's resolved action catalogue — the same
  catalogue the action router pre-validates dispatches against, so a passing check
  means the dispatch will not be rejected for an unknown action.
- `reads` are verified against **observed telemetry**: the union of keys in the
  device's current state and in its retained `device_history` snapshots. This is the
  same principle as the rest of the platform — the answer comes from what the device
  was seen to do, not from what something claimed about it.

`reads` therefore has three outcomes, and the binding UI distinguishes them because
they mean different things:

| Outcome | Meaning |
|---|---|
| `reported` | The field has been seen in this device's state or history. |
| `not-yet-observed` | The device exists and has published, but never this field. |
| `no-history` | Nothing retained for this device yet, so there is no evidence either way. |

`not-yet-observed` is a warning an operator may knowingly override — a flow meter
that has never run has never reported a flow rate, and that is a legitimate install.
`no-history` is explicitly *absence of evidence* rather than evidence of absence, and
is worded that way rather than being folded in with the case above it.

Roles are additive. Topic-matching stays valid for site-local projects, and the
existing showcase projects are not required to migrate.

### 4. Installed vs library — two rows, and installing copies

- **Installed Automation Project** — unchanged. `automation_projects` keyed by
  `automation_id`, compiled columns on the rule, executes.
- **Library Project** — a new `library_projects` table with its own id, name, version
  and manifest, plus `library_project_files`. It has **no rule row**, so nothing
  registers it with the engine and it cannot trigger. Inert by construction rather
  than by a flag someone must remember to check.

Installing a library project **copies** the tree into a new rule. It does not
reference it. A reference would mean editing a template silently changes the behaviour
of live automations on a physical site — the installed instance must keep doing what
it was installed doing until someone deliberately updates it. The new rule records
`installed_from_library_id` and `installed_from_version` so drift is visible and an
update is an explicit act.

Because installing copies, multiple instances of one library project are a natural
consequence rather than a feature to build.

Save UX follows from the split: **Save** updates the installed project (today's
behaviour, unchanged); **Save to Library** creates or updates a library row;
**Export** produces a package. Normal Save never touches the library.

### 5. Import security — validate and store, never run

Import is two steps, and the first one executes nothing:

1. `POST /api/library/import` — validate the manifest, normalise every path, enforce
   the existing bounds, and compile. On success, store a library project. Compilation
   is required at import because a package that cannot compile is not a package, but
   compilation is not execution: no rule row exists, so the engine never sees it.
2. Install — the operator reviews the declared permissions and requirements, supplies
   device bindings, chooses the owning tab, and only then is a rule created and
   registered.

Two invariants hold regardless of what a package claims:

- **A package cannot grant itself authority.** `authored_unrestricted` and
  `owner_tab_id` are set from the installing user's role and chosen tab, exactly as
  `POST /api/automations` does today.
- **Scope stays derived.** `AutomationScopeResolver` continues to recompute authority
  per dispatch from the live tab exposure.

### 5a. Declared permissions constrain, by intersection

A declaration that can only ever *shrink* authority needs no change to how authority is
derived. `AuthorizationScope` already returns `deviceIds` and `collections` as sets, so
the declaration composes as one extra filter at the end of `resolve()`:

```
effective = derived ∩ declared          (when a declaration exists)
effective = derived                     (when none does)
```

Intersection is the whole safety argument. There is no ordering, precedence or merge
rule to get wrong, and no input a package can supply that makes the result larger than
`derived`. A declared device role bound to something the owning tab does not expose
simply is not in the intersection, so it resolves to `undefined` at runtime exactly as
an unexposed device already does.

Three consequences worth stating plainly:

- A packaged automation is confined to the roles it declared. Today a scoped automation
  may touch **every** device its tab exposes, declared or not, so this is a genuine
  tightening rather than paperwork.
- It tightens admin-installed packages too. `unrestricted ∩ declared` is `declared`, so
  an admin installing a package no longer hands it system-wide authority by virtue of
  being an admin.
- Projects with no manifest are unaffected. The showcase and any site-local project keep
  today's derived scope, so this cannot break existing automations.

The declaration is stored at install from the manifest, not read back out of the package
at dispatch time — a package file that could still be edited after approval would put
the enforcement input outside the approved boundary.

### 6. Versioning

`formatVersion` is an integer on the package envelope and gates the reader: an unknown
`formatVersion` is refused rather than parsed optimistically. `version` is semver and
describes the project's own content. A library row is identified by `(id, version)`;
revision history is out of scope, and re-importing the same version replaces the
library copy without touching installed instances.

### 7. State and data migrations are never part of a package

Packages carry code and requirements. They do not carry, and cannot execute, state or
Data Store migrations.

Automation state belongs to the installed instance, and Data Store collections are
site-owned and tab-scoped. A package able to migrate either would be able to write to
site data before an operator approved anything — the exact property step 5 exists to
prevent. Where a new version expects different state, its Logic handles absent or
legacy keys itself, which is what the showcase's `initialise*()` functions already do.

### 8. Git is a later transport, not the base model

Nothing about saving, reusing, sharing or importing an automation requires Git. If a
Git integration arrives it operates over this same package format, adding source
history, external collaboration and CI on top. Making Git the base abstraction would
put a version-control dependency in front of "reuse this on my own site".

### Browse Panes

"YOUR AUTOMATIONS" lists **library projects**, and selecting one installs it and adds
an ordinary `automation` pane bound to the new rule id. It must not introduce a new
pane type: `PANE_REGISTRY` is a compile-time object and the dashboard store deletes
panes whose type it does not contain, so a dynamically registered type would vanish
from saved layouts. This also keeps the existing 1:1 pane↔rule coupling intact.

## Alternatives considered

### Zip or tarball packages

Conventional and tool-friendly, and it would allow a `README.md` and non-source assets
the current extension allowlist rejects. Rejected for now: it adds decompression
limits, archive entry-name traversal and a second path normaliser beside the one the
compiler already enforces, for no capability the JSON envelope lacks. Revisit if
packages need to carry assets.

### One table with a `kind` column for installed and library projects

Fewer tables, but `automation_projects.automation_id` is the primary key *and* the
foreign key to a rule — a library row has no rule, so it would need that column
nullable, which breaks the cascade that currently guarantees a deleted rule leaves no
orphan tree. A separate table keeps the installed invariant exactly as it is.

### Install by reference to the library copy

Attractive for updates: fix the template, every instance improves. Rejected because
these automations command physical hardware. An edit in a library template silently
changing what a pump does on a live site is the wrong default; an update must be
something an operator chose.

### Bind devices by topic pattern rather than by role

Requires no new manifest concept and matches how showcase projects already work. But
topics are site conventions, not a contract — the shared automation would still be
guessing another installation's naming. Roles move the guess to install time where a
human can answer it.

### A new capability system for package requirements

Rejected. `CapabilityDescriptor` + the action catalogue already express "supports
action T", and the action router already validates against it. A parallel system would
drift from the one the runtime actually enforces.

### A declarative state schema, so `reads` can be checked against a contract

The tidy answer: have devices declare their telemetry fields and check requirements
against that. Rejected because nothing declares it today, so the schema would have to be
authored by hand per device and would then be a second claim to keep true — and a stale
schema is worse than none, because it reads as authoritative. Observed telemetry is
already collected, is evidence rather than assertion, and degrades into a statement about
evidence (`no-history`) instead of a false negative.

### Leave `reads` advisory

The first draft of this ADR did exactly that, on the grounds that untyped state cannot be
verified. That conflated "no schema" with "no evidence". `StateHistory` has been recording
per-device snapshots all along, so the check was available and the caveat was unnecessary.

### Make declared permissions a grant rather than a narrowing

This is what a package manifest usually means elsewhere, and it would let a package
request access a tab has not been given. Rejected outright: it would make an imported
file an input to an authority decision. Narrowing gets the useful half — an automation
confined to what it said it needed — with none of that risk.

### Defer declared-permission enforcement to a later decision

Also what the first draft did, reasoning that a stored declaration should not join an
enforcement path that is otherwise entirely derived. That was over-cautious. Framed as an
intersection the safety property is immediate and total, and deferring it would have
shipped a manifest field that looked load-bearing and was not — which is its own kind of
dishonesty.

## Consequences

### Positive

- A project gains an identity independent of a running rule, which is what makes
  reuse, multiple instances, versioning and provenance possible at all.
- Imported code cannot execute before an explicit install.
- The binding seam removes hard-coded topics from shareable projects without breaking
  site-local ones.
- Both kinds of requirement are checked against something real — the catalogue the
  runtime enforces, and telemetry the platform observed — so a passing check means
  something and a failing one says which of the two it is.
- Declared permissions actually confine the automation, and by intersection, so no
  package can talk its way into more than the installing user's tab already exposes.
  Packaged automations end up more tightly bound than hand-authored ones, including
  when an admin installs them.

### Negative / accepted trade-offs

- Two more tables and a copy-on-install step; the same project now exists in more than
  one place, and a library update does not reach installed instances. That is the
  intended safety property, but it does mean "update all instances" becomes a feature
  someone will ask for.
- `reads` verification inherits `StateHistory`'s retention. With 100 snapshots per
  device throttled to one per 5 s, a field a device publishes rarely can fall out of
  history and read as `not-yet-observed`. The outcome is a warning rather than a
  refusal, so the failure mode is a confusing warning, not a blocked install — but the
  check is bounded by retention and the wording must not imply otherwise.
- Intersection means an install can be *narrower* than the operator expects: bind a role
  to a device the owning tab does not expose and the automation will find nothing there.
  That is the correct outcome, and the binding UI has to make the reason obvious rather
  than leaving a silent `undefined` to be debugged at runtime.
- Enforcing a declaration adds a second reason a scoped automation may fail to see a
  device. "Not exposed by the tab" and "not declared by the package" need distinct
  diagnostics or they will be indistinguishable in the field.
- `devices.role()` adds a second device-resolution path beside topic matching. Two
  idioms in the showcase is a documentation cost.
- The extension allowlist means no `README.md` inside a package, so description lives
  in the manifest until the format carries assets.

## Revisit when

- Packages need to carry non-source assets or a README — that is the trigger for
  reconsidering the archive format.
- A declaration needs to cover something `AuthorizationScope` does not carry — an event
  namespace, or a raw-MQTT topic pattern. Intersection is total because devices and
  collections are sets of ids; a pattern is not, so that needs both a new scope dimension
  and a matching rule, and it is a separate decision from this one.
- `reads` verification needs to survive retention — either a longer-lived per-device
  observed-field index, or a declared schema after all. Reach for the index first; it
  keeps the answer grounded in observation.
- Third-party or untrusted package authors become possible. Signing, provenance and
  the per-project capability manifest ADR-0005 anticipates all belong to that step, not
  this one.
- "Update every installed instance of this library project" is requested, which needs a
  diff and conflict story for locally edited installs.

## Implementation anchors

- `src/automations/automation-project.ts` (compiler, bounds, path normalisation)
- `src/db/migrations/015-automation-projects.ts`
- `src/api/routes/automation.routes.ts` (authoring scope, `registerUiRule`)
- `src/automations/automation-scope-resolver.ts` (the intersection point)
- `src/core/state-history.ts` (observed-field verification)
- `src/connectors/action-router.ts`, `src/connectors/connector.interface.ts`
- `frontend/src/lib/pane-registry.ts`, `frontend/src/components/PanePicker.tsx`
- `docs/adr/0007-automation-projects-esbuild.md`
- `docs/ROADMAP.md` ("Reusable Aeolus applications"), `docs/BACKLOG.md`
