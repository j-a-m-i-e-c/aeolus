// frontend/src/components/AutomationProjectEditor.tsx — Progressive multi-file Automation Project editor

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  Blocks,
  BookOpen,
  FileCode2,
  FolderTree,
  Plus,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";
import { automationProjectModelUri } from "../lib/automation-project-model";
import "../lib/monaco-setup";
import type { TranspileError } from "./automation-authoring";
import { SnippetPicker } from "./SnippetPicker";

export interface AutomationProjectFile {
  path: string;
  content: string;
}

export interface AutomationProjectSource {
  files: AutomationProjectFile[];
  logicEntry: string;
  uiEntry: string | null;
  legacyProjection?: boolean;
}

interface Props {
  project: AutomationProjectSource;
  onChange: (project: AutomationProjectSource) => void;
  onSave?: () => void;
  errors?: (TranspileError & { path?: string })[];
  readOnly?: boolean;
  /** Stable automation identity used to isolate Monaco models between projects. */
  projectKey?: string;
  /** Live state written by Logic. Shown contextually while authoring UI. */
  liveState?: Record<string, unknown>;
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json"];
type Monaco = Parameters<OnMount>[1];
type ToolPanel = "insert" | "api" | "files" | null;
type AuthoringSurface = "logic" | "ui";

const DEFAULT_UI_SOURCE = `export default function AutomationView(aeolus: CustomComponentProps) {
  return (
    <div className="p-4">
      <div className="text-sm font-semibold">{aeolus.ruleName}</div>
      <div className="mt-1 text-xs opacity-70">
        Add the UI your automation needs here.
      </div>
    </div>
  );
}
`;

const LOGIC_API = [
  ["context", "Trigger topic, device, state and timestamp"],
  ["devices.get(id)", "Read a device snapshot"],
  ["devices.list()", "List registered devices"],
  ["devices.action(id, type, params?)", "Control one device through CommandService"],
  ["devices.actionAll(filter, type, params?)", "Control matching scoped devices"],
  ["mqtt.publish(topic, payload)", "Publish an MQTT message"],
  ["state.get(key)", "Read automation state"],
  ["state.set(key, value)", "Persist automation state"],
  ["state.getAll()", "Read all automation state"],
  ["http.get(url, opts?)", "Call a public HTTP/HTTPS endpoint"],
  ["http.post(url, opts?)", "POST to a public HTTP/HTTPS endpoint"],
  ["events.emit(name, payload?)", "Emit a scoped Automation event"],
  ["db.*", "Optional Data Store API when enabled"],
  ["log.info / warn / error", "Write to the Aeolus event log"],
] as const;

const UI_API = [
  ["aeolus.devices", "Live device registry"],
  ["aeolus.read(key)", "Read state written by Logic"],
  ["aeolus.save(key, value)", "Persist state for Logic"],
  ["aeolus.saveAndFire(key, value)", "Persist state and fire Logic"],
  ["aeolus.fire(eventName, payload?)", "Fire Logic from the UI"],
  ["aeolus.control(id, type, params?)", "Control a device"],
  ["aeolus.publish(topic, payload)", "Publish an MQTT message"],
  ["aeolus.history", "Recent automation executions"],
  ["aeolus.ruleName / enabled / lastFired", "Automation metadata"],
] as const;

function languageFor(filePath: string): string {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".json")) return "json";
  return "plaintext";
}

function surfaceForPath(project: AutomationProjectSource, path: string): AuthoringSurface {
  if (path === project.uiEntry || path.startsWith("ui/")) return "ui";
  return "logic";
}

function formatStateValue(value: unknown): string {
  try {
    const rendered = typeof value === "string" ? `"${value}"` : JSON.stringify(value);
    if (rendered === undefined) return String(value);
    return rendered.length > 72 ? `${rendered.slice(0, 69)}…` : rendered;
  } catch {
    return String(value);
  }
}

function syncProjectModels(monaco: Monaco, projectKey: string, project: AutomationProjectSource) {
  const namespace = `file:///aeolus-project/${encodeURIComponent(projectKey || "project")}/`;
  const wanted = new Set<string>();

  for (const file of project.files) {
    const uriString = automationProjectModelUri(projectKey, file.path);
    wanted.add(uriString);
    const uri = monaco.Uri.parse(uriString);
    const existing = monaco.editor.getModel(uri);
    if (!existing) {
      monaco.editor.createModel(file.content, languageFor(file.path), uri);
    } else if (existing.getValue() !== file.content) {
      existing.setValue(file.content);
    }
  }

  // Dispose deleted files from this project only. Models from other automations
  // have a different namespace and are never touched.
  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString();
    if (uri.startsWith(namespace) && !wanted.has(uri)) model.dispose();
  }
}

async function loadAeolusTypes(monaco: Parameters<OnMount>[1]) {
  try {
    const [logicResponse, uiResponse] = await Promise.all([
      authFetch(`${API_URL}/api/automations/types`),
      authFetch(`${API_URL}/api/automations/ui-types`),
    ]);
    if (logicResponse.ok) {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        await logicResponse.text(),
        "file:///aeolus-project/aeolus-runtime.d.ts",
      );
    }
    if (uiResponse.ok) {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        await uiResponse.text(),
        "file:///aeolus-project/aeolus-ui.d.ts",
      );
    }
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];\nexport function useEffect(effect: () => void | (() => void), deps?: any[]): void;\nexport function useMemo<T>(factory: () => T, deps: any[]): T;\nexport function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;\nexport function useRef<T>(initial: T): { current: T };\ndeclare const React: any;\nexport default React;`,
      "file:///node_modules/react/index.d.ts",
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `export function jsx(type: any, props: any, key?: any): any;\nexport function jsxs(type: any, props: any, key?: any): any;\nexport const Fragment: any;`,
      "file:///node_modules/react/jsx-runtime/index.d.ts",
    );
  } catch {
    // The editor remains usable without server-provided IntelliSense.
  }
}

function ApiReference({ mode, liveState }: { mode: AuthoringSurface; liveState: Record<string, unknown> }) {
  const entries = mode === "ui" ? UI_API : LOGIC_API;
  const stateEntries = Object.entries(liveState);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-[#2A3441]">
        <BookOpen size={14} className="text-[#5CE1E6]" />
        <div>
          <div className="text-xs font-semibold text-[#E6EDF3]">{mode === "ui" ? "UI API" : "Logic API"}</div>
          <div className="text-[9px] text-[#6B7785]">Available without imports</div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {mode === "ui" && stateEntries.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-[#6B7785] mb-2">Live state</div>
            <div className="space-y-1.5">
              {stateEntries.map(([key, value]) => (
                <div key={key} className="rounded-md bg-[#0B0F14] border border-[#202A36] px-2 py-1.5 font-mono text-[10px]">
                  <div className="text-[#5CE1E6]">aeolus.read(&quot;{key}&quot;)</div>
                  <div className="text-[#778493] truncate" title={formatStateValue(value)}>{formatStateValue(value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-[#6B7785] mb-2">Reference</div>
          <div className="space-y-3">
            {entries.map(([signature, description]) => (
              <div key={signature}>
                <div className="text-[10px] font-mono font-semibold text-[#E6EDF3]">{signature}</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-[#7E8A98]">{description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AutomationProjectEditor({
  project,
  onChange,
  onSave,
  errors = [],
  readOnly = false,
  projectKey = "project",
  liveState = {},
}: Props) {
  const firstPath = project.logicEntry || project.files[0]?.path || "logic/index.ts";
  const [activePath, setActivePath] = useState(firstPath);
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const activeFile = project.files.find((file) => file.path === activePath) ?? project.files[0];
  const hasExtraFiles = project.files.some((file) => file.path !== project.logicEntry && file.path !== project.uiEntry);
  const canRevealFiles = !readOnly || hasExtraFiles;

  useEffect(() => {
    setActivePath(project.logicEntry || project.files[0]?.path || "logic/index.ts");
    setToolPanel(null);
    // Deliberately keyed on automation identity alone. `project` is a new object on
    // every keystroke, so depending on it would reset the open tab while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  useEffect(() => {
    if (monacoRef.current) syncProjectModels(monacoRef.current, projectKey, project);
  }, [project, projectKey]);

  useEffect(() => {
    if (project.files.length === 0) return;
    if (!project.files.some((file) => file.path === activePath)) {
      setActivePath(project.logicEntry || project.files[0].path);
    }
  }, [activePath, project.files, project.logicEntry]);

  const sortedFiles = useMemo(
    () => [...project.files].sort((a, b) => a.path.localeCompare(b.path)),
    [project.files],
  );
  const errorCountByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const error of errors) {
      if (error.path) {
        const path = error.path.replace(/^\//, "");
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    return counts;
  }, [errors]);

  const updateFile = useCallback((filePath: string, content: string) => {
    onChange({
      ...project,
      files: project.files.map((file) => file.path === filePath ? { ...file, content } : file),
    });
  }, [onChange, project]);

  const addFile = useCallback(() => {
    const requested = window.prompt("Project file path", "shared/helpers.ts")?.trim();
    if (!requested) return;
    if (requested.startsWith("/") || requested.includes("..") || requested.includes("\\") || !CODE_EXTENSIONS.some((ext) => requested.endsWith(ext))) {
      window.alert("Use a relative .ts/.tsx/.js/.jsx/.json path inside the project.");
      return;
    }
    if (project.files.some((file) => file.path === requested)) {
      setActivePath(requested);
      setToolPanel("files");
      return;
    }
    onChange({ ...project, files: [...project.files, { path: requested, content: "" }] });
    setActivePath(requested);
    setToolPanel("files");
  }, [onChange, project]);

  const addUi = useCallback(() => {
    if (project.uiEntry) {
      setActivePath(project.uiEntry);
      return;
    }
    const path = "ui/index.tsx";
    const existing = project.files.find((file) => file.path === path);
    onChange({
      ...project,
      uiEntry: path,
      files: existing ? project.files : [...project.files, { path, content: DEFAULT_UI_SOURCE }],
    });
    setActivePath(path);
  }, [onChange, project]);

  const removeActiveFile = useCallback(() => {
    if (!activeFile || activeFile.path === project.logicEntry || activeFile.path === project.uiEntry) return;
    if (!window.confirm(`Delete ${activeFile.path}?`)) return;
    const next = project.files.filter((file) => file.path !== activeFile.path);
    onChange({ ...project, files: next });
    setActivePath(project.logicEntry || next[0]?.path || "logic/index.ts");
  }, [activeFile, onChange, project]);

  const insertText = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const selection = ed.getSelection();
    if (!selection) return;
    ed.executeEdits("aeolus-insert", [{ range: selection, text, forceMoveMarkers: true }]);
    ed.focus();
  }, []);

  const handleMount: OnMount = useCallback((ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    syncProjectModels(monaco, projectKey, project);
    monaco.editor.defineTheme("aeolus-project-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "3BA4FF" },
        { token: "string", foreground: "5CE1E6" },
        { token: "comment", foreground: "6B7785" },
        { token: "number", foreground: "F59E0B" },
      ],
      colors: {
        "editor.background": "#0B0F14",
        "editor.foreground": "#E6EDF3",
        "editorGutter.background": "#0B0F14",
        "editorLineNumber.foreground": "#566170",
        "editor.selectionBackground": "#3BA4FF33",
      },
    });
    monaco.editor.setTheme("aeolus-project-dark");
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      allowJs: true,
      noEmit: true,
      strict: false,
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    void loadAeolusTypes(monaco);
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave?.());
  }, [onSave, project, projectKey]);

  if (!activeFile) return null;

  const activeErrors = errors.filter((error) => !error.path || error.path.replace(/^\//, "") === activeFile.path);
  const logicSelected = activeFile.path === project.logicEntry;
  const uiSelected = !!project.uiEntry && activeFile.path === project.uiEntry;
  const activeSurface = surfaceForPath(project, activeFile.path);
  const extraFileSelected = !logicSelected && !uiSelected;
  const liveStateEntries = Object.entries(liveState);

  const toggleTool = (panel: Exclude<ToolPanel, null>) => {
    setToolPanel((current) => current === panel ? null : panel);
  };

  return (
    <div className="h-full min-h-[300px] flex flex-col overflow-hidden rounded-xl border border-[#2A3441] bg-[#0B0F14] shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
      {/* Logic and UI are the primary entry points. Files opens the complete project; the remaining buttons are contextual tools. */}
      <div className="min-h-12 shrink-0 flex flex-wrap items-stretch border-b border-[#2A3441] bg-[#10161F]">
        <div className="flex items-stretch px-2">
          <button
            onClick={() => { setActivePath(project.logicEntry); setToolPanel(null); }}
            className={`relative min-w-24 px-4 text-xs font-semibold transition-colors ${logicSelected && toolPanel !== "files" ? "text-[#5CE1E6]" : "text-[#7E8A98] hover:text-[#C3CDD7]"}`}
          >
            Logic
            {logicSelected && toolPanel !== "files" && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#5CE1E6]" />}
          </button>
          <button
            onClick={() => {
              setToolPanel(null);
              if (project.uiEntry) setActivePath(project.uiEntry);
              else if (!readOnly) addUi();
            }}
            disabled={readOnly && !project.uiEntry}
            className={`relative min-w-24 px-4 text-xs font-semibold transition-colors ${uiSelected && toolPanel !== "files" ? "text-[#3BA4FF]" : "text-[#7E8A98] hover:text-[#C3CDD7] disabled:opacity-40 disabled:hover:text-[#7E8A98]"}`}
            title={project.uiEntry ? "Edit automation UI" : readOnly ? "This automation has no custom UI" : "Create automation UI"}
          >
            UI
            {uiSelected && toolPanel !== "files" && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#3BA4FF]" />}
          </button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 px-2 py-1.5 before:content-[''] before:h-5 before:w-px before:bg-[#2A3441] before:mr-1">
          {canRevealFiles && (
            <>
              <button
                onClick={() => toggleTool("files")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[10px] font-semibold transition-colors ${
                  toolPanel === "files" || extraFileSelected
                    ? "bg-[#5CE1E6]/10 text-[#DDFBFF] border-[#5CE1E6]/35"
                    : "bg-[#5CE1E6]/5 text-[#9AD9E5] border-[#5CE1E6]/20 hover:bg-[#5CE1E6]/10 hover:text-[#DDFBFF]"
                }`}
                title="Browse the complete Automation Project"
              >
                <FolderTree size={12} /> Files
              </button>
              <span className="h-5 w-px bg-[#2A3441] mx-1" aria-hidden="true" />
            </>
          )}
          <button
              onClick={() => toggleTool("insert")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors ${toolPanel === "insert" ? "bg-[#1A2330] text-[#E6EDF3]" : "text-[#7E8A98] hover:text-[#C3CDD7] hover:bg-[#171E28]"}`}
              title="Insert an Aeolus pattern at the cursor"
            >
              <Blocks size={12} /> Insert
            </button>
          <button
            onClick={() => toggleTool("api")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors ${toolPanel === "api" ? "bg-[#1A2330] text-[#E6EDF3]" : "text-[#7E8A98] hover:text-[#C3CDD7] hover:bg-[#171E28]"}`}
            title="Show the API available to this file"
          >
            <BookOpen size={12} /> API
          </button>
          <button
              onClick={() => editorRef.current?.getAction("editor.action.formatDocument")?.run()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium text-[#7E8A98] hover:text-[#C3CDD7] hover:bg-[#171E28] transition-colors"
              title="Format current file"
            >
              <WandSparkles size={12} /> Format
            </button>
        </div>
      </div>

      {extraFileSelected && (
        <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-[#202A36] bg-[#0E141C]">
          <FileCode2 size={11} className="text-[#6B7785]" />
          <span className="text-[10px] font-mono text-[#9AA6B2] truncate flex-1">{activeFile.path}</span>
          {!readOnly && (
            <button onClick={removeActiveFile} className="flex items-center gap-1 text-[9px] text-[#6B7785] hover:text-[#EF4444] transition-colors" title="Delete current file">
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <Editor
              path={automationProjectModelUri(projectKey, activeFile.path)}
              language={languageFor(activeFile.path)}
              // Models are synchronised explicitly by syncProjectModels(). Keeping
              // Monaco uncontrolled avoids @monaco-editor/react replaying `value`
              // through the previous model while Logic/UI paths are switching.
              defaultValue={activeFile.content}
              theme="aeolus-project-dark"
              onMount={handleMount}
              onChange={(value) => updateFile(activeFile.path, value ?? "")}
              keepCurrentModel
              options={{
                readOnly: false,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                lineHeight: 21,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                padding: { top: 18, bottom: 18 },
                tabSize: 2,
                wordWrap: "off",
                bracketPairColorization: { enabled: true },
                renderLineHighlight: "line",
                smoothScrolling: true,
              }}
            />
          </div>

          {activeSurface === "ui" && liveStateEntries.length > 0 && (
            <div className="shrink-0 flex items-center gap-3 overflow-x-auto border-t border-[#202A36] bg-[#0E141C] px-3 py-2">
              <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-[#6B7785]">Live state</span>
              {liveStateEntries.map(([key, value]) => (
                <div key={key} className="shrink-0 text-[10px] font-mono" title={`aeolus.read(\"${key}\") → ${formatStateValue(value)}`}>
                  <span className="text-[#5CE1E6]">{key}</span>
                  <span className="text-[#566170] mx-1">→</span>
                  <span className="text-[#B9C4CF]">{formatStateValue(value)}</span>
                </div>
              ))}
            </div>
          )}

          {activeErrors.length > 0 && (
            <div className="max-h-24 overflow-auto border-t border-[#EF4444]/30 bg-[#EF4444]/5 px-3 py-2">
              {activeErrors.map((error, index) => (
                <div key={`${error.line}-${error.column}-${index}`} className="text-[10px] font-mono text-[#FCA5A5]">
                  {error.line}:{error.column} {error.message}
                </div>
              ))}
            </div>
          )}
        </section>

        {toolPanel && (
          <aside className="w-[280px] max-w-[42%] shrink-0 border-l border-[#2A3441] bg-[#10161F] overflow-hidden">
            {toolPanel === "insert" && (
              <SnippetPicker
                title="Insert"
                mode={activeSurface}
                onClose={() => setToolPanel(null)}
                onInsert={insertText}
              />
            )}

            {toolPanel === "api" && (
              <div className="h-full relative">
                <ApiReference mode={activeSurface} liveState={liveState} />
                <button
                  onClick={() => setToolPanel(null)}
                  className="absolute right-2.5 top-2.5 p-1 rounded text-[#6B7785] hover:text-[#C3CDD7] hover:bg-[#1A2330] transition-colors"
                  title="Close API reference"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {toolPanel === "files" && (
              <div className="h-full flex flex-col">
                <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-[#2A3441]">
                  <FolderTree size={14} className="text-[#5CE1E6]" />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-[#E6EDF3]">Project files</div>
                    <div className="text-[9px] text-[#6B7785]">Add modules only when you need them</div>
                  </div>
                  {!readOnly && (
                    <button onClick={addFile} className="flex items-center gap-1 px-2 py-1 rounded text-[9px] text-[#7E8A98] hover:text-[#E6EDF3] hover:bg-[#1A2330]" title="Add project file">
                      <Plus size={11} /> New
                    </button>
                  )}
                  <button onClick={() => setToolPanel(null)} className="p-1 rounded text-[#6B7785] hover:text-[#C3CDD7] hover:bg-[#1A2330]" title="Close project files">
                    <X size={13} />
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {sortedFiles.map((file) => {
                    const selected = file.path === activeFile.path;
                    const count = errorCountByPath.get(file.path) ?? 0;
                    return (
                      <button
                        key={file.path}
                        onClick={() => setActivePath(file.path)}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[10px] font-mono text-left transition-colors ${selected ? "bg-[#1A2330] text-[#E6EDF3]" : "text-[#7E8A98] hover:bg-[#171E28] hover:text-[#B9C4CF]"}`}
                        title={file.path}
                      >
                        <FileCode2 size={12} className={file.path === project.logicEntry ? "text-[#5CE1E6]" : file.path === project.uiEntry ? "text-[#3BA4FF]" : "text-[#6B7785]"} />
                        <span className="truncate">{file.path}</span>
                        {count > 0 && <span className="ml-auto text-[#EF4444]">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
