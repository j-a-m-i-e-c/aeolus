# Automation Projects

Aeolus code automations are authored as bounded multi-file **Automation Projects**. This is the normal authoring model, not an optional advanced mode: a simple automation can remain one Logic file, while larger automations can add UI and local modules without becoming separate services.

```text
Automation Project
├── logic/
│   ├── index.ts       # backend entrypoint
│   └── helpers.ts     # optional local module
├── ui/
│   └── index.tsx      # optional React entrypoint
└── shared/
    └── constants.ts   # optional shared source
          ↓
  in-memory esbuild bundle
          ↓
 isolated Logic / opaque-origin UI runtimes
```

## Authoring model

The editor has one consistent hierarchy:

1. **Name**
2. **Trigger** — MQTT, Schedule, or None/manual-only
3. **Logic | UI | Files** — primary project navigation
4. **Insert | API | Format** — contextual editor tools

`Logic` opens first. `UI` is optional. `Files` exposes the complete project tree when local modules are useful; it is a first-party part of the same project rather than a second authoring product.

New projects use one canonical scaffold everywhere:

```ts
// logic/index.ts
export default async function run(context: EventContext) {
  log.info(`Event: ${context.topic}`);
  state.set("lastEvent", { topic: context.topic, at: Date.now() });
}
```

`EventContext` and the other sandbox APIs are supplied by Aeolus' public editor type declarations.

## Logic entrypoint and completion

The preferred entrypoint is a default-exported function. The project compiler registers that function with Aeolus' internal completion wrapper, so host-mediated device commands are tracked before the sandbox execution resolves.

Pre-release projects that already contain an explicit `automation({...})` registration are also accepted. This is compatibility for authored source, not a separate editor or storage model. The helper supports `continueOnFailure` for deliberately non-fail-fast action sequences.

## Source model

The API accepts a bounded virtual source tree:

```ts
interface AutomationProject {
  logicEntry?: string;       // defaults to logic/index.ts
  uiEntry?: string | null;   // defaults to ui/index.tsx when present
  files: Array<{
    path: string;
    content: string;
  }>;
}
```

Project paths are relative. A project is limited to 64 source files, 128 KiB per file and 512 KiB total authored source. Supported source extensions are `.ts`, `.tsx`, `.js`, `.jsx` and `.json`.

## Import boundary

Logic and UI may import files inside the same project using relative imports. Imports cannot escape the project root. Arbitrary npm packages, Node built-ins, filesystem access and runtime module loading are not introduced by Automation Projects.

The UI bundle may import the React modules supplied by the UI sandbox (`react`, `react-dom` and `react/jsx-runtime`). Those remain host-provided externals.

## Compilation, persistence and migration

`src/automations/automation-project.ts` validates and bundles the project entirely in memory. The authored tree is persisted in `automation_projects` / `automation_project_files`.

`automation_rules.script_source`, `compiled_js`, `ui_source` and `compiled_ui` remain a runtime projection used by the execution engine and upgrade compatibility. They are not a second authoring source of truth for new code automations.

Migration 016 promotes pre-Project script rows into a project containing `logic/index.ts` and optional `ui/index.tsx`. The read path can also project an unpromoted historical row so an interrupted/partial upgrade does not make old Logic inaccessible. New script create/update flows use Automation Projects.

## Security boundary

Multi-file authoring does not widen runtime privileges. Logic is bundled and executed in a fresh `isolated-vm` context; UI is bundled and loaded into the existing opaque-origin iframe. Relative project imports are resolved at save time and do not become runtime filesystem or package access.

## Public demo

Seeded showcase automations use the same Automation Project model as normal authoring. Shared demo source is read-only. “Try a New Automation” creates a browser-local Project draft; the public demo does not persist arbitrary visitor source into the shared backend.

## Demo source

Demo manifests under `demo/seed/tabs/` contain metadata and project references. Current authored demo source lives under `demo/seed/projects/<project>/`. Files under `docs/reference/legacy-demo-tabs/` are historical snapshots only and must not be used as current authoring examples.
