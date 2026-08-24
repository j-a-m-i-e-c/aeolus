# Automation Projects

Aeolus script automations are authored as bounded multi-file **Automation Projects**. A simple automation can stay in one file; larger automations can split Logic, UI and shared code into local modules without becoming separate services.

```text
Automation Project
├── logic/
│   ├── index.ts       # backend entrypoint
│   └── helpers.ts
├── ui/
│   ├── index.tsx      # optional React entrypoint
│   └── types.ts
└── shared/
    └── constants.ts
          ↓
  in-memory esbuild bundle
          ↓
 existing Logic/UI sandboxes
```

## Logic entrypoint

New projects use an ordinary default-exported function:

```ts
// logic/index.ts
export default async function run(context: EventContext) {
  const tank = devices.get("header-tank");
  if (Number(tank?.state?.level) < 20) {
    log.warn("Header tank low");
  }
}
```

The project compiler adds Aeolus' existing completion wrapper internally. Authors do not need to write `automation({...})` to receive ordered device-action completion and failure semantics.

The legacy `automation()` helper remains supported for old automations and deliberately simple condition/action rules. It is a convenience, not the default project scaffold.

## Source model

The API accepts a bounded source tree:

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

Logic and UI can import other files in the same project with relative imports. Imports cannot escape the project root. Arbitrary npm packages, Node built-ins, filesystem access and runtime module loading are not introduced by the project model.

The UI bundle may import the React modules already supplied by the existing UI sandbox (`react`, `react-dom` and `react/jsx-runtime`). Those remain host-provided externals.

## Compilation and persistence

`src/automations/automation-project.ts` validates and bundles the project entirely in memory. The authored file tree is stored in `automation_projects` / `automation_project_files` while `automation_rules.script_source`, `compiled_js`, `ui_source` and `compiled_ui` remain the runtime projection used by the existing engine.

This keeps multi-file authoring separate from the execution trust boundary: Automation Projects still run through the same isolated backend and opaque-origin UI sandboxes as legacy script automations.

## Backwards compatibility

Existing `script_source` / `ui_source` automations remain valid. `GET /api/automations/:id/project` projects a legacy automation as `logic/index.ts` plus optional `ui/index.tsx`, so it can be inspected through the project API without a destructive migration.

Saving a project stores the authored tree and updates the legacy runtime projection. Explicitly saving a legacy single-file automation continues to use the old path.

## Public demo

Seeded showcase automations use the same Automation Project model as normal authoring. Public-demo visitors can browse those project files read-only. “Try a New Automation” creates a browser-local project draft; dashboard persistence is disabled in public-demo mode, and keeping the draft does not call the shared automation create/update APIs.

## Demo source

The demo manifests under `scripts/seed/tabs/` contain only metadata and project references. Authored demo source lives under `scripts/seed/projects/<project>/`. This prevents the seeder definitions from becoming giant template-string source containers and makes the showcased code representative of the product's real authoring model.
