import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

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
