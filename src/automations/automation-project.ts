// src/automations/automation-project.ts — Multi-file Automation Project compiler + persistence

import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { build, type Loader, type Message, type Plugin } from "esbuild";

export const DEFAULT_LOGIC_ENTRY = "logic/index.ts";
export const DEFAULT_UI_ENTRY = "ui/index.tsx";
export const MAX_PROJECT_FILES = 64;
export const MAX_PROJECT_BYTES = 512 * 1024;
export const MAX_PROJECT_FILE_BYTES = 128 * 1024;

const ALLOWED_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const UI_EXTERNALS = new Set(["react", "react-dom", "react/jsx-runtime"]);

export interface AutomationProjectFile {
  path: string;
  content: string;
}

export interface AutomationProject {
  files: AutomationProjectFile[];
  logicEntry?: string;
  uiEntry?: string | null;
}

export interface StoredAutomationProject {
  automationId: string;
  files: AutomationProjectFile[];
  logicEntry: string;
  uiEntry: string | null;
  legacyProjection: boolean;
}

export interface ProjectCompileError {
  path?: string;
  line: number;
  column: number;
  message: string;
}

export class AutomationProjectCompileError extends Error {
  constructor(public readonly details: ProjectCompileError[]) {
    super("Automation Project compilation failed");
    this.name = "AutomationProjectCompileError";
  }
}

export interface CompiledAutomationProject {
  compiledJs: string;
  compiledUi: string | null;
  logicSource: string;
  uiSource: string | null;
  files: AutomationProjectFile[];
  logicEntry: string;
  uiEntry: string | null;
}

function normalizeProjectPath(input: string): string {
  if (!input || input.includes("\\") || input.startsWith("/") || input.includes("\0")) {
    throw new AutomationProjectCompileError([{ line: 1, column: 0, message: `Invalid project path: ${input || "<empty>"}` }]);
  }
  const normalized = path.posix.normalize(input);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new AutomationProjectCompileError([{ line: 1, column: 0, message: `Project path escapes its root: ${input}` }]);
  }
  const ext = path.posix.extname(normalized);
  if (!ALLOWED_SOURCE_EXTENSIONS.has(ext)) {
    throw new AutomationProjectCompileError([{ path: normalized, line: 1, column: 0, message: `Unsupported project file type: ${ext || "<none>"}` }]);
  }
  return normalized;
}

function normalizeProject(project: AutomationProject): { map: Map<string, string>; files: AutomationProjectFile[]; logicEntry: string; uiEntry: string | null } {
  if (!Array.isArray(project.files) || project.files.length === 0) {
    throw new AutomationProjectCompileError([{ line: 1, column: 0, message: "Automation Project must contain at least one source file" }]);
  }
  if (project.files.length > MAX_PROJECT_FILES) {
    throw new AutomationProjectCompileError([{ line: 1, column: 0, message: `Automation Project exceeds ${MAX_PROJECT_FILES} files` }]);
  }

  const map = new Map<string, string>();
  let totalBytes = 0;
  for (const file of project.files) {
    const filePath = normalizeProjectPath(file.path);
    const content = String(file.content ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_PROJECT_FILE_BYTES) {
      throw new AutomationProjectCompileError([{ path: filePath, line: 1, column: 0, message: `Project file exceeds ${MAX_PROJECT_FILE_BYTES} bytes` }]);
    }
    totalBytes += bytes;
    if (map.has(filePath)) {
      throw new AutomationProjectCompileError([{ path: filePath, line: 1, column: 0, message: `Duplicate project file: ${filePath}` }]);
    }
    map.set(filePath, content);
  }
  if (totalBytes > MAX_PROJECT_BYTES) {
    throw new AutomationProjectCompileError([{ line: 1, column: 0, message: `Automation Project exceeds ${MAX_PROJECT_BYTES} bytes` }]);
  }

  const logicEntry = normalizeProjectPath(project.logicEntry || DEFAULT_LOGIC_ENTRY);
  const requestedUiEntry = project.uiEntry === null
    ? null
    : project.uiEntry !== undefined
      ? normalizeProjectPath(project.uiEntry)
      : map.has(DEFAULT_UI_ENTRY) ? DEFAULT_UI_ENTRY : null;

  if (!map.has(logicEntry)) {
    throw new AutomationProjectCompileError([{ path: logicEntry, line: 1, column: 0, message: `Logic entry file not found: ${logicEntry}` }]);
  }
  if (requestedUiEntry && !map.has(requestedUiEntry)) {
    throw new AutomationProjectCompileError([{ path: requestedUiEntry, line: 1, column: 0, message: `UI entry file not found: ${requestedUiEntry}` }]);
  }
  const effectiveUiEntry = requestedUiEntry;

  return {
    map,
    files: [...map.entries()].map(([filePath, content]) => ({ path: filePath, content })).sort((a, b) => a.path.localeCompare(b.path)),
    logicEntry,
    uiEntry: effectiveUiEntry,
  };
}

function mapBuildErrors(messages: Message[]): ProjectCompileError[] {
  return messages.map((msg) => ({
    path: msg.location?.file || undefined,
    line: msg.location?.line ?? 1,
    column: msg.location?.column ?? 0,
    message: msg.text,
  }));
}

function virtualProjectPlugin(files: Map<string, string>, mode: "logic" | "ui", entry: string): Plugin {
  return {
    name: "aeolus-automation-project",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^__aeolus_entry__$/ }, () => ({ path: "__aeolus_entry__", namespace: "aeolus-project" }));

      buildApi.onResolve({ filter: /.*/, namespace: "aeolus-project" }, (args) => {
        const spec = args.path;
        if (mode === "ui" && UI_EXTERNALS.has(spec)) return { path: spec, external: true };
        if (!spec.startsWith(".")) {
          return { errors: [{ text: `Only relative project imports are allowed${mode === "ui" ? " (React is provided by the UI sandbox)" : ""}: ${spec}` }] };
        }

        const base = args.importer === "__aeolus_entry__" ? "" : path.posix.dirname(args.importer);
        const requested = path.posix.normalize(path.posix.join(base, spec));
        if (requested.startsWith("../") || requested === "..") {
          return { errors: [{ text: `Import escapes Automation Project: ${spec}` }] };
        }

        const candidates = [
          requested,
          `${requested}.ts`, `${requested}.tsx`, `${requested}.js`, `${requested}.jsx`, `${requested}.json`,
          `${requested}/index.ts`, `${requested}/index.tsx`, `${requested}/index.js`, `${requested}/index.jsx`,
        ];
        const found = candidates.find((candidate) => files.has(candidate));
        if (!found) return { errors: [{ text: `Project import not found: ${spec} from ${args.importer}` }] };
        return { path: found, namespace: "aeolus-project" };
      });

      buildApi.onLoad({ filter: /.*/, namespace: "aeolus-project" }, (args) => {
        if (args.path === "__aeolus_entry__") {
          const q = JSON.stringify(`./${entry}`);
          return mode === "logic"
            ? {
                // Project Logic supports both the preferred module-style default export
                // and legacy `automation({...})` source. A namespace import is valid
                // even when the legacy entry has no default export; importing it runs
                // its existing registration side effect, while modern projects are
                // registered here from their default function.
                contents: `import * as entryModule from ${q};\nconst run = entryModule.default;\nif (typeof run === "function") automation({ actions: [run] });`,
                loader: "ts",
                resolveDir: "/",
              }
            : { contents: `import Component from ${q};\nexport default Component;`, loader: "tsx", resolveDir: "/" };
        }
        const contents = files.get(args.path);
        if (contents === undefined) return { errors: [{ text: `Project file not found: ${args.path}` }] };
        const ext = path.posix.extname(args.path);
        const loader: Loader = ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : ext === ".json" ? "json" : ext === ".js" ? "js" : "ts";
        return { contents, loader, resolveDir: `/${path.posix.dirname(args.path)}` };
      });
    },
  };
}

async function bundle(files: Map<string, string>, mode: "logic" | "ui", entry: string): Promise<string> {
  try {
    const result = await build({
      entryPoints: ["__aeolus_entry__"],
      bundle: true,
      write: false,
      target: "es2022",
      platform: "browser",
      format: mode === "logic" ? "iife" : "esm",
      jsx: "automatic",
      jsxImportSource: "react",
      sourcemap: false,
      logLevel: "silent",
      plugins: [virtualProjectPlugin(files, mode, entry)],
    });
    return result.outputFiles[0]?.text ?? "";
  } catch (error) {
    const buildError = error as { errors?: Message[] };
    if (buildError.errors?.length) throw new AutomationProjectCompileError(mapBuildErrors(buildError.errors));
    throw error;
  }
}

/** Compile a project into the existing sandbox/runtime projection. */
export async function compileAutomationProject(project: AutomationProject): Promise<CompiledAutomationProject> {
  const normalized = normalizeProject(project);
  const compiledJs = await bundle(normalized.map, "logic", normalized.logicEntry);
  const compiledUi = normalized.uiEntry ? await bundle(normalized.map, "ui", normalized.uiEntry) : null;
  return {
    compiledJs,
    compiledUi,
    logicSource: normalized.map.get(normalized.logicEntry)!,
    uiSource: normalized.uiEntry ? normalized.map.get(normalized.uiEntry)! : null,
    files: normalized.files,
    logicEntry: normalized.logicEntry,
    uiEntry: normalized.uiEntry,
  };
}

/** Persist the authored tree atomically after successful compilation. */
export function saveAutomationProject(db: DatabaseType, automationId: string, compiled: CompiledAutomationProject): void {
  const now = Date.now();
  const persist = () => {
    db.prepare(`INSERT INTO automation_projects (automation_id, logic_entry, ui_entry, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(automation_id) DO UPDATE SET logic_entry=excluded.logic_entry, ui_entry=excluded.ui_entry, updated_at=excluded.updated_at`)
      .run(automationId, compiled.logicEntry, compiled.uiEntry, now, now);
    db.prepare("DELETE FROM automation_project_files WHERE automation_id = ?").run(automationId);
    const insert = db.prepare(`INSERT INTO automation_project_files (automation_id, path, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (const file of compiled.files) insert.run(automationId, file.path, file.content, now, now);
  };

  if (db.inTransaction) persist();
  else db.transaction(persist)();
}

/** Read a project, projecting legacy two-blob automations when no project row exists. */
export function readAutomationProject(db: DatabaseType, automationId: string): StoredAutomationProject | null {
  const rule = db.prepare("SELECT id, rule_type, script_source, ui_source FROM automation_rules WHERE id = ?").get(automationId) as
    | { id: string; rule_type: string; script_source: string | null; ui_source: string | null }
    | undefined;
  if (!rule) return null;

  const project = db.prepare("SELECT logic_entry, ui_entry FROM automation_projects WHERE automation_id = ?").get(automationId) as
    | { logic_entry: string; ui_entry: string | null }
    | undefined;
  if (!project) {
    const files: AutomationProjectFile[] = [];
    if (rule.script_source != null) files.push({ path: DEFAULT_LOGIC_ENTRY, content: rule.script_source });
    if (rule.ui_source != null) files.push({ path: DEFAULT_UI_ENTRY, content: rule.ui_source });
    return {
      automationId,
      files,
      logicEntry: DEFAULT_LOGIC_ENTRY,
      uiEntry: rule.ui_source != null ? DEFAULT_UI_ENTRY : null,
      legacyProjection: true,
    };
  }

  const files = db.prepare("SELECT path, content FROM automation_project_files WHERE automation_id = ? ORDER BY path").all(automationId) as AutomationProjectFile[];
  return {
    automationId,
    files,
    logicEntry: project.logic_entry,
    uiEntry: project.ui_entry,
    legacyProjection: false,
  };
}
