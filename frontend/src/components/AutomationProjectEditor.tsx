// frontend/src/components/AutomationProjectEditor.tsx — Progressive multi-file Automation Project editor

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { FileCode2, Folder, FolderTree, Plus, Save, Trash2, WandSparkles, X } from "lucide-react";
import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";
import { automationProjectModelUri } from "../lib/automation-project-model";
import "../lib/monaco-setup";
import type { TranspileError } from "./ScriptEditor";

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
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json"];
type Monaco = Parameters<OnMount>[1];

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

function languageFor(filePath: string): string {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".json")) return "json";
  return "plaintext";
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

export function AutomationProjectEditor({
  project,
  onChange,
  onSave,
  errors = [],
  readOnly = false,
  projectKey = "project",
}: Props) {
  const firstPath = project.logicEntry || project.files[0]?.path || "logic/index.ts";
  const [activePath, setActivePath] = useState(firstPath);
  const [filesOpen, setFilesOpen] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const activeFile = project.files.find((file) => file.path === activePath) ?? project.files[0];
  const hasExtraFiles = project.files.some((file) => file.path !== project.logicEntry && file.path !== project.uiEntry);
  const canRevealFiles = !readOnly || hasExtraFiles;

  useEffect(() => {
    setActivePath(project.logicEntry || project.files[0]?.path || "logic/index.ts");
    setFilesOpen(false);
    // Deliberately keyed on automation identity alone. `project` is a new object on
    // every keystroke, so depending on it would reset the open tab and collapse the
    // file tree while the author is typing.
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
      setFilesOpen(true);
      return;
    }
    onChange({ ...project, files: [...project.files, { path: requested, content: "" }] });
    setActivePath(requested);
    setFilesOpen(true);
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

  const closeFiles = () => {
    setFilesOpen(false);
    if (!logicSelected && !uiSelected) setActivePath(project.logicEntry);
  };

  return (
    <div className="h-full min-h-[280px] flex flex-col overflow-hidden rounded-xl border border-[#2A3441] bg-[#0B0F14]">
      {/* Logic and UI are the stable top-level authoring model. The full file tree
          is progressive disclosure for automations that actually need modules. */}
      <div className="h-10 shrink-0 flex items-center gap-1.5 px-2 border-b border-[#2A3441] bg-[#10161F]">
        <button
          onClick={() => setActivePath(project.logicEntry)}
          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${logicSelected ? "bg-[#1A2330] text-[#5CE1E6]" : "text-[#7E8A98] hover:text-[#B9C4CF] hover:bg-[#171E28]"}`}
        >
          Logic
        </button>
        <button
          onClick={() => project.uiEntry ? setActivePath(project.uiEntry) : (!readOnly && addUi())}
          disabled={readOnly && !project.uiEntry}
          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${uiSelected ? "bg-[#1A2330] text-[#3BA4FF]" : "text-[#7E8A98] hover:text-[#B9C4CF] hover:bg-[#171E28] disabled:hover:text-[#7E8A98] disabled:hover:bg-transparent"}`}
          title={project.uiEntry ? "Edit automation UI" : readOnly ? "This automation has no custom UI" : "Create automation UI"}
        >
          UI
        </button>

        <div className="flex-1" />

        {canRevealFiles && (
          <button
            onClick={() => filesOpen ? closeFiles() : setFilesOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] transition-colors ${filesOpen ? "bg-[#1A2330] text-[#E6EDF3]" : "text-[#7E8A98] hover:text-[#B9C4CF] hover:bg-[#171E28]"}`}
            title="Show the complete Automation Project file tree"
          >
            <FolderTree size={12} />
            Project files
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
        {filesOpen && (
          <aside className="sm:w-52 sm:min-w-52 max-h-32 sm:max-h-none border-b sm:border-b-0 sm:border-r border-[#2A3441] bg-[#10161F] flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2A3441]">
              <Folder size={13} className="text-[#5CE1E6]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9AA6B2] flex-1">Files</span>
              {!readOnly && (
                <button onClick={addFile} className="p-1 rounded text-[#6B7785] hover:text-[#E6EDF3] hover:bg-[#1A2330]" title="Add file">
                  <Plus size={13} />
                </button>
              )}
              <button onClick={closeFiles} className="p-1 rounded text-[#6B7785] hover:text-[#E6EDF3] hover:bg-[#1A2330]" title="Hide file tree">
                <X size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-1.5 flex sm:block gap-1">
              {sortedFiles.map((file) => {
                const selected = file.path === activeFile.path;
                const count = errorCountByPath.get(file.path) ?? 0;
                return (
                  <button
                    key={file.path}
                    onClick={() => setActivePath(file.path)}
                    className={`shrink-0 sm:w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-mono text-left transition-colors ${selected ? "bg-[#1A2330] text-[#E6EDF3]" : "text-[#7E8A98] hover:bg-[#171E28] hover:text-[#B9C4CF]"}`}
                    title={file.path}
                  >
                    <FileCode2 size={11} className={file.path === project.logicEntry ? "text-[#5CE1E6]" : file.path === project.uiEntry ? "text-[#3BA4FF]" : "text-[#6B7785]"} />
                    <span className="truncate">{file.path}</span>
                    {count > 0 && <span className="ml-auto text-[#EF4444]">{count}</span>}
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        <section className="flex-1 min-w-0 flex flex-col">
          <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-[#202A36] bg-[#0E141C]">
            <span className="text-[10px] font-mono text-[#778493] truncate flex-1">{activeFile.path}</span>
            {activeFile.path === project.logicEntry && <span className="text-[9px] uppercase tracking-wider text-[#5CE1E6]/80">Entry</span>}
            {activeFile.path === project.uiEntry && <span className="text-[9px] uppercase tracking-wider text-[#3BA4FF]/80">Entry</span>}
            {!readOnly && (
              <>
                <button onClick={() => editorRef.current?.getAction("editor.action.formatDocument")?.run()} className="p-1 text-[#6B7785] hover:text-[#E6EDF3]" title="Format file"><WandSparkles size={12} /></button>
                <button onClick={onSave} className="p-1 text-[#6B7785] hover:text-[#5CE1E6]" title="Save automation"><Save size={12} /></button>
                {filesOpen && (
                  <button disabled={activeFile.path === project.logicEntry || activeFile.path === project.uiEntry} onClick={removeActiveFile} className="p-1 text-[#6B7785] hover:text-[#EF4444] disabled:opacity-20" title="Delete file"><Trash2 size={12} /></button>
                )}
              </>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <Editor
              path={automationProjectModelUri(projectKey, activeFile.path)}
              language={languageFor(activeFile.path)}
              value={activeFile.content}
              theme="aeolus-project-dark"
              onMount={handleMount}
              onChange={(value) => updateFile(activeFile.path, value ?? "")}
              keepCurrentModel
              options={{
                readOnly,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                padding: { top: 14, bottom: 14 },
                tabSize: 2,
                wordWrap: readOnly ? "on" : "off",
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>
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
      </div>
    </div>
  );
}
