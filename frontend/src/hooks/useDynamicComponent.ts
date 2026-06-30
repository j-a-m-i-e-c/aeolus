// frontend/src/hooks/useDynamicComponent.ts — Dynamic loader for custom automation UI modules

import { useState, useEffect, useRef, type ComponentType } from "react";
import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";

/**
 * Supported external specifiers that are rewritten to reference
 * `window.__AEOLUS_EXTERNALS__` instead of ES module imports.
 */
const EXTERNAL_SPECIFIERS = new Set(["react", "react-dom", "react/jsx-runtime"]);

/**
 * Rewrite ES module import statements for React externals into
 * destructuring assignments from `window.__AEOLUS_EXTERNALS__`.
 *
 * Handles patterns like:
 *   import { useState, useEffect } from "react";
 *   import { jsx as _jsx } from "react/jsx-runtime";
 *   import React from "react";
 *   import * as React from "react";
 *
 * Exported separately for testability.
 */
export function rewriteImports(source: string): string {
  // Match: import <clause> from "<specifier>";
  // Captures: full match, import clause, specifier
  const importRe =
    /import\s+([\s\S]*?)\s+from\s+["'](react(?:\/jsx-runtime|-dom)?)["']\s*;/g;

  return source.replace(importRe, (_match, clause: string, specifier: string) => {
    if (!EXTERNAL_SPECIFIERS.has(specifier)) {
      // Not one of our externals — leave it alone
      return _match;
    }

    const trimmed = clause.trim();

    // Namespace import: import * as React from "react"
    if (trimmed.startsWith("*")) {
      const alias = trimmed.replace(/^\*\s+as\s+/, "").trim();
      return `const ${alias} = window.__AEOLUS_EXTERNALS__["${specifier}"];`;
    }

    // Named imports: import { useState, useEffect } from "react"
    // May also have a default alongside: import React, { useState } from "react"
    const namedMatch = trimmed.match(/\{([^}]*)\}/);
    const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*,/);

    const parts: string[] = [];

    if (defaultMatch) {
      parts.push(
        `const ${defaultMatch[1]} = window.__AEOLUS_EXTERNALS__["${specifier}"].default || window.__AEOLUS_EXTERNALS__["${specifier}"];`,
      );
    }

    if (namedMatch) {
      // Convert import alias syntax (as) to destructuring syntax (:)
      // e.g. "jsx as _jsx" → "jsx: _jsx"
      const destructured = namedMatch[1].replace(/\b(\w+)\s+as\s+(\w+)\b/g, "$1: $2");
      parts.push(
        `const {${destructured}} = window.__AEOLUS_EXTERNALS__["${specifier}"];`,
      );
    }

    if (parts.length > 0) return parts.join("\n");

    // Default-only import: import React from "react"
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      return `const ${trimmed} = window.__AEOLUS_EXTERNALS__["${specifier}"].default || window.__AEOLUS_EXTERNALS__["${specifier}"];`;
    }

    // Fallback — leave unchanged
    return _match;
  });
}

export interface DynamicComponentState {
  Component: ComponentType<Record<string, unknown>> | null;
  loading: boolean;
  error: string | null;
}

/**
 * React hook that fetches a compiled UI module from the backend,
 * rewrites React import specifiers, loads it via blob URL + dynamic import(),
 * and returns the default-exported component.
 *
 * @param entityId - The rule or panel ID used to fetch the module
 * @param hasUiSource - Whether the entity has a compiled UI source to load
 * @param moduleUrl - Optional URL override for the module endpoint.
 *   Defaults to the automation UI module URL for backward compatibility.
 *   For panels, pass: `/api/panels/${panelId}/ui-module`
 */
export function useDynamicComponent(
  entityId: string,
  hasUiSource: boolean,
  moduleUrl?: string,
): DynamicComponentState {
  const [Component, setComponent] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);

  useEffect(() => {
    if (!entityId || !hasUiSource) {
      setComponent(null);
      setLoading(false);
      setError(null);
      return;
    }

    const currentVersion = ++versionRef.current;
    let blobUrl: string | null = null;

    async function loadModule() {
      setLoading(true);
      setError(null);
      setComponent(null);

      try {
        const url = moduleUrl || `${API_URL}/api/automations/${entityId}/ui-module`;
        const res = await authFetch(url);

        // Check if this request is still current
        if (currentVersion !== versionRef.current) return;

        if (!res.ok) {
          setError(`Failed to load UI module (${res.status})`);
          setLoading(false);
          return;
        }

        const source = await res.text();

        if (currentVersion !== versionRef.current) return;

        // Rewrite React import specifiers to use globals
        const rewritten = rewriteImports(source);

        // Create blob URL and dynamically import
        const blob = new Blob([rewritten], { type: "application/javascript" });
        blobUrl = URL.createObjectURL(blob);

        const mod = await import(/* @vite-ignore */ blobUrl);

        // Revoke blob URL after import
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;

        if (currentVersion !== versionRef.current) return;

        if (!mod.default) {
          setError("Module does not export a default component");
          setLoading(false);
          return;
        }

        if (typeof mod.default !== "function") {
          setError("Module default export is not a valid React component");
          setLoading(false);
          return;
        }

        setComponent(() => mod.default);
        setLoading(false);
      } catch (err) {
        // Clean up blob URL on error
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          blobUrl = null;
        }

        if (currentVersion !== versionRef.current) return;

        const message =
          err instanceof TypeError
            ? "Connection error — could not reach the server"
            : err instanceof Error
              ? err.message
              : "Failed to load UI module";

        setError(message);
        setLoading(false);
      }
    }

    loadModule();
  }, [entityId, hasUiSource, moduleUrl]);

  return { Component, loading, error };
}
