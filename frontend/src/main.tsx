import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// Self-hosted fonts (no Google Fonts CDN) — keeps the app fully local/offline.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
// Configure Monaco to load from the bundled package (no CDN) — must run before
// any editor mounts.
import "./lib/monaco-setup";

// Register external dependencies as globals so dynamically loaded UI modules
// can resolve React imports without bundling their own copy.
declare global {
  interface Window {
    __AEOLUS_EXTERNALS__: Record<string, unknown>;
  }
}

window.__AEOLUS_EXTERNALS__ = {
  "react": React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
