// frontend/src/components/UiEditor.tsx — Monaco editor for custom automation UI components (TSX)

import { useRef, useEffect, useCallback } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

export interface UiEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onEditorReady?: (api: { insertText: (text: string) => void }) => void;
}

/** Define the Aeolus dark theme for Monaco (reuses same theme as ScriptEditor) */
function defineAeolusDarkTheme(monaco: Parameters<OnMount>[1]) {
  // Theme may already be registered by ScriptEditor — defining again is safe
  monaco.editor.defineTheme("aeolus-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "3BA4FF" },
      { token: "string", foreground: "5CE1E6" },
      { token: "comment", foreground: "6B7785" },
      { token: "identifier", foreground: "E6EDF3" },
      { token: "type", foreground: "9AA6B2" },
      { token: "type.identifier", foreground: "9AA6B2" },
      { token: "number", foreground: "F59E0B" },
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

/** Fetch UI component type definitions and register with Monaco TS language service */
async function loadUiTypeDefinitions(monaco: Parameters<OnMount>[1]) {
  // Register React JSX runtime stub so the TS service understands JSX syntax.
  // Semantic validation is disabled (backend transpiler catches real errors on save)
  // so we only need the minimal module declaration for JSX to parse correctly.
  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    `declare module "react/jsx-runtime" {
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
  export const Fragment: any;
}
declare module "react" {
  const React: any;
  export = React;
  export default React;
}
declare module "./types" {
  export interface CustomComponentProps {
    devices: any[];
    ruleId: string;
    ruleName: string;
    lastFired: number | null;
    enabled: boolean;
    deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
    mqttPublish: (topic: string, payload: string) => void;
    executionHistory: any[];
    state: Map<string, unknown>;
    stateSet: (key: string, value: unknown) => void;
  }
}`,
    "react-stubs.d.ts"
  );

  try {
    const res = await fetch(`${API_URL}/api/automations/ui-types`);
    if (!res.ok) return;
    const types = await res.text();
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      types,
      "aeolus-ui-types.d.ts"
    );
  } catch {
    // Type definitions unavailable — editor still works, just without IntelliSense
  }
}

export function UiEditor({
  initialValue,
  onChange,
  onSave,
  onEditorReady,
}: UiEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const handleMount: OnMount = useCallback((ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;

    defineAeolusDarkTheme(monaco);
    monaco.editor.setTheme("aeolus-dark");

    // Configure TypeScript defaults for TSX components
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      noEmit: true,
      strict: false,
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    loadUiTypeDefinitions(monaco);

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
        path="aeolus-custom-ui.tsx"
        defaultValue={initialValue ?? ""}
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
