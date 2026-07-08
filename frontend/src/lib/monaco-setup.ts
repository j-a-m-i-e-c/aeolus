// frontend/src/lib/monaco-setup.ts — Load Monaco from the bundled package, not a CDN.
//
// @monaco-editor/react defaults to injecting a <script> that fetches the editor
// engine from cdn.jsdelivr.net. That breaks offline / air-gapped deployments and
// is blocked by our Content-Security-Policy. Pointing the loader at the locally
// installed monaco-editor package (and wiring its web workers through Vite) keeps
// the whole editor self-hosted — no network access required at runtime.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

// The dashboard only edits TypeScript/TSX, so we bundle just the core editor
// worker and the TypeScript language worker. Any other language falls back to
// the core worker.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// Use the bundled monaco-editor instead of the default CDN download.
loader.config({ monaco });
