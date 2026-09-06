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
- **Capability requirements are half-expressible.** `CapabilityDescriptor` +
  `ActionRouter.resolveActionCatalog` already make "this device supports action T with
  params P" machine-checkable, and the router pre-validates actions against it.
  "This device reports field Y" has **no** representation: device `state` is an
  untyped `Record<string, unknown>` and `capabilities` is frequently `[]` for MQTT and
  simulated devices.
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
    "dataStore": { "write": ["tank-history"] },
    "events":    { "emit": ["farm/water/#"] }
  }
}
```

`trigger` is a **suggestion** shown at install, not a grant: a package that could
silently bind itself to a topic would be choosing its own activation condition.

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

Requirements are checked at bind time as far as the platform can actually check them,
and are honest about the rest:

- `actions` are **verified** against the device's resolved action catalogue, which is
  the same catalogue the action router pre-validates dispatches against.
- `reads` are **advisory**. Device state is untyped and a field may legitimately be
  absent until first telemetry, so the binding UI reports "field not currently
  reported" as information, not as a rejection. Claiming verification here would be a
  fabricated guarantee.

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
  `POST /api/automations` does today. The manifest's `permissions` block is a
  declaration to *display* and, later, to *narrow* — never to widen.
- **Scope stays derived.** `AutomationScopeResolver` continues to recompute authority
  per dispatch. A declared permission that exceeds current scope is simply not
  available at runtime; the install UI should say so rather than appearing to grant it.

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
drift from the one the runtime actually enforces. The genuine gap is state-field
requirements, and this ADR marks those advisory rather than inventing a schema for
untyped device state.

## Consequences

### Positive

- A project gains an identity independent of a running rule, which is what makes
  reuse, multiple instances, versioning and provenance possible at all.
- Imported code cannot execute before an explicit install.
- The binding seam removes hard-coded topics from shareable projects without breaking
  site-local ones.
- Requirements are checked with the mechanism the runtime already enforces, so a
  passing check means something.
- Authority remains derived, so no package can talk its way into more than the
  installing user had.

### Negative / accepted trade-offs

- Two more tables and a copy-on-install step; the same project now exists in more than
  one place, and a library update does not reach installed instances. That is the
  intended safety property, but it does mean "update all instances" becomes a feature
  someone will ask for.
- `reads` requirements are advisory. An operator can bind a device that never reports
  the field, and the automation will simply find nothing. Better than a check that
  claims more than it can know, but it is a real rough edge.
- Declared permissions are display-and-narrow only at first, so a manifest can look
  more load-bearing than it is. The install UI has to be explicit that scope is derived
  from the tab.
- `devices.role()` adds a second device-resolution path beside topic matching. Two
  idioms in the showcase is a documentation cost.
- The extension allowlist means no `README.md` inside a package, so description lives
  in the manifest until the format carries assets.

## Revisit when

- Packages need to carry non-source assets or a README — that is the trigger for
  reconsidering the archive format.
- Declared permissions need to actually constrain rather than describe. That is a
  change to `AutomationScopeResolver`, and it should be its own decision: it would make
  a stored declaration part of an enforcement path that is currently entirely derived.
- Third-party or untrusted package authors become possible. Signing, provenance and
  the per-project capability manifest ADR-0005 anticipates all belong to that step, not
  this one.
- "Update every installed instance of this library project" is requested, which needs a
  diff and conflict story for locally edited installs.

## Implementation anchors

- `src/automations/automation-project.ts` (compiler, bounds, path normalisation)
- `src/db/migrations/015-automation-projects.ts`
- `src/api/routes/automation.routes.ts` (authoring scope, `registerUiRule`)
- `src/automations/automation-scope-resolver.ts`
- `src/connectors/action-router.ts`, `src/connectors/connector.interface.ts`
- `frontend/src/lib/pane-registry.ts`, `frontend/src/components/PanePicker.tsx`
- `docs/adr/0007-automation-projects-esbuild.md`
- `docs/ROADMAP.md` ("Reusable Aeolus applications"), `docs/BACKLOG.md`
