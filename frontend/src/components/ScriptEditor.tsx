// frontend/src/components/ScriptEditor.tsx — Monaco editor with Aeolus dark theme

import { useRef, useEffect, useCallback } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { authFetch } from "../lib/auth-fetch";
import "../lib/monaco-setup";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

export interface TranspileError {
  line: number;
  column: number;
  message: string;
}

export interface ScriptEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  errors?: TranspileError[];
  /** Ref callback to expose the insertText method to parent components. */
  onEditorReady?: (api: { insertText: (text: string) => void }) => void;
}

const DEFAULT_TEMPLATE = `automation({
  conditions: [
    function check(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function act(context) {
      log.info(\`Event: \${context.topic} → \${JSON.stringify(context.state)}\`);
    },
  ],
});
`;

/** Define the Aeolus dark theme for Monaco */
function defineAeolusDarkTheme(monaco: Parameters<OnMount>[1]) {
  monaco.editor.defineTheme("aeolus-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      // Keywords: if, const, let, var, return, await, async, function, class, etc.
      { token: "keyword", foreground: "3BA4FF" },
      { token: "keyword.ts", foreground: "3BA4FF" },
      // Strings
      { token: "string", foreground: "5CE1E6" },
      { token: "string.ts", foreground: "5CE1E6" },
      // Comments
      { token: "comment", foreground: "6B7785" },
      { token: "comment.ts", foreground: "6B7785" },
      // Functions
      { token: "identifier", foreground: "E6EDF3" },
      { token: "identifier.ts", foreground: "E6EDF3" },
      // Types
      { token: "type", foreground: "9AA6B2" },
      { token: "type.identifier", foreground: "9AA6B2" },
      { token: "type.identifier.ts", foreground: "9AA6B2" },
      // Numbers
      { token: "number", foreground: "F59E0B" },
      { token: "number.ts", foreground: "F59E0B" },
      // Delimiters & operators
      { token: "delimiter", foreground: "9AA6B2" },
      { token: "operator", foreground: "3BA4FF" },
    ],
    colors: {
      "editor.background": "#0B0F14",
      "editor.foreground": "#E6EDF3",
      "editorGutter.background": "#121821",
      "editorLineNumber.foreground": "#6B7785",
      "editorLineNumber.activeForeground": "#9AA6B2",
      "editor.lineHighlightBackground": "#121821",
      "editor.selectionBackground": "#3BA4FF33",
      "editorCursor.foreground": "#3BA4FF",
      "editorWidget.background": "#121821",
      "editorWidget.border": "#2A3441",
      "editorSuggestWidget.background": "#121821",
      "editorSuggestWidget.border": "#2A3441",
      "editorSuggestWidget.selectedBackground": "#1A2330",
      "input.background": "#0B0F14",
      "input.border": "#2A3441",
      "scrollbarSlider.background": "#2A344166",
      "scrollbarSlider.hoverBackground": "#2A344199",
    },
  });
}

/** Fetch sandbox type definitions and register them with Monaco TS service */
async function loadTypeDefinitions(monaco: Parameters<OnMount>[1]) {
  try {
    const res = await authFetch(`${API_URL}/api/automations/types`);
    if (!res.ok) return;
    const types = await res.text();
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      types,
      "aeolus-sandbox.d.ts"
    );
  } catch {
    // Type definitions unavailable — editor still works, just without IntelliSense
  }
}

/** Set error markers on the editor model from backend transpilation errors */
function setErrorMarkers(
  monaco: Parameters<OnMount>[1],
  model: editor.ITextModel,
  errors: TranspileError[]
) {
  const markers: editor.IMarkerData[] = errors.map((err) => ({
    severity: monaco.MarkerSeverity.Error,
    message: err.message,
    startLineNumber: err.line,
    startColumn: err.column || 1,
    endLineNumber: err.line,
    endColumn: (err.column || 1) + 20,
  }));
  monaco.editor.setModelMarkers(model, "aeolus-transpile", markers);
}

export function ScriptEditor({
  initialValue,
  onChange,
  onSave,
  errors,
  onEditorReady,
}: ScriptEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const handleMount: OnMount = useCallback((ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;

    // Define and apply theme
    defineAeolusDarkTheme(monaco);
    monaco.editor.setTheme("aeolus-dark");

    // Configure TypeScript defaults for sandbox scripts
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      noEmit: true,
      strict: false,
    });

    // Suppress module-related diagnostics — sandbox scripts don't use modules
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    // Load type definitions for IntelliSense
    loadTypeDefinitions(monaco);

    // Ctrl+S / Cmd+S to save
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (onSave) {
        onSave(ed.getValue());
      }
    });

    // Expose insertText API to parent
    if (onEditorReady) {
      onEditorReady({
        insertText: (text: string) => {
          const position = ed.getPosition();
          if (!position) return;
          ed.executeEdits("snippet-insert", [
            {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              text: "\n" + text + "\n",
            },
          ]);
          ed.focus();
        },
      });
    }
  }, [onSave, onEditorReady]);

  const handleChange: OnChange = useCallback(
    (value) => {
      if (onChange && value !== undefined) {
        onChange(value);
      }
    },
    [onChange]
  );

  // Update error markers when errors prop changes
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;

    const model = ed.getModel();
    if (!model) return;

    if (errors && errors.length > 0) {
      setErrorMarkers(monaco, model, errors);
    } else {
      monaco.editor.setModelMarkers(model, "aeolus-transpile", []);
    }
  }, [errors]);

  return (
    <div
      className="rounded-xl border border-[#2A3441] overflow-hidden h-full"
      style={{
        background: "#121821",
        borderRadius: "14px",
      }}
    >
      <Editor
        height="100%"
        defaultLanguage="typescript"
        defaultValue={initialValue ?? DEFAULT_TEMPLATE}
        theme="aeolus-dark"
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          fontWeight: "500",
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
          renderLineHighlight: "gutter",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          tabSize: 2,
          automaticLayout: true,
          wordWrap: "on",
          bracketPairColorization: { enabled: true },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
}
