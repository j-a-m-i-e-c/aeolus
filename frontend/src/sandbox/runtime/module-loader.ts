// frontend/src/sandbox/runtime/module-loader.ts — In-frame compiled-module loader
//
// Runs INSIDE the opaque-origin sandbox iframe. Rewrites React import specifiers
// in the compiled UI module to reference the runtime's bundled React instance
// (exposed on the frame's own global as `__SANDBOX_EXTERNALS__`), then builds a
// Blob in the frame's own realm and imports it there.
//
// This is the relocated + retargeted version of the former
// `frontend/src/hooks/useDynamicComponent.ts` `rewriteImports`. The crux of the
// isolation design: the HOST fetches the module text (with its token) and posts
// the inert source string into the frame; the FRAME evaluates it here. The token
// never crosses into the frame — only text does.

import type { ComponentType } from "react";

/**
 * The name of the frame-local global holding the sandbox runtime's bundled
 * dependency instances. Set by `entry.ts` before any module is loaded. This is
 * the in-frame analogue of the host's `window.__AEOLUS_EXTERNALS__`, but it lives
 * in the sandboxed opaque-origin realm and is unreachable from the host page.
 */
export const SANDBOX_EXTERNALS_GLOBAL = "__SANDBOX_EXTERNALS__";

/**
 * Supported external specifiers that are rewritten to reference the frame-local
 * `__SANDBOX_EXTERNALS__` object instead of ES module imports.
 */
const EXTERNAL_SPECIFIERS = new Set(["react", "react-dom", "react/jsx-runtime"]);

/**
 * Rewrite ES module import statements for React externals into destructuring
 * assignments from the frame-local `globalThis.__SANDBOX_EXTERNALS__`.
 *
 * Handles patterns like:
 *   import { useState, useEffect } from "react";
 *   import { jsx as _jsx } from "react/jsx-runtime";
 *   import React from "react";
 *   import * as React from "react";
 *   import React, { useState } from "react";
 *
 * Exported separately for testability.
 */
export function rewriteImports(source: string): string {
  const global = `globalThis.${SANDBOX_EXTERNALS_GLOBAL}`;

  // Match: import <clause> from "<specifier>";
  const importRe =
    /import\s+([\s\S]*?)\s+from\s+["'](react(?:\/jsx-runtime|-dom)?)["']\s*;/g;

  return source.replace(importRe, (match, clause: string, specifier: string) => {
    if (!EXTERNAL_SPECIFIERS.has(specifier)) {
      // Not one of our externals — leave it alone
      return match;
    }

    const trimmed = clause.trim();

    // Namespace import: import * as React from "react"
    if (trimmed.startsWith("*")) {
      const alias = trimmed.replace(/^\*\s+as\s+/, "").trim();
      return `const ${alias} = ${global}["${specifier}"];`;
    }

    // Named imports (possibly with a leading default):
    //   import { useState } from "react"
    //   import React, { useState } from "react"
    const namedMatch = trimmed.match(/\{([^}]*)\}/);
    const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*,/);

    const parts: string[] = [];

    if (defaultMatch) {
      parts.push(
        `const ${defaultMatch[1]} = ${global}["${specifier}"].default || ${global}["${specifier}"];`,
      );
    }

    if (namedMatch) {
      // Convert import alias syntax (as) to destructuring syntax (:)
      // e.g. "jsx as _jsx" → "jsx: _jsx"
      const destructured = namedMatch[1].replace(/\b(\w+)\s+as\s+(\w+)\b/g, "$1: $2");
      parts.push(`const {${destructured}} = ${global}["${specifier}"];`);
    }

    if (parts.length > 0) return parts.join("\n");

    // Default-only import: import React from "react"
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
      return `const ${trimmed} = ${global}["${specifier}"].default || ${global}["${specifier}"];`;
    }

    // Fallback — leave unchanged
    return match;
  });
}

/**
 * Rewrite, build a Blob in the frame's own realm, and dynamically import the
 * compiled UI module. Returns the default-exported React component.
 *
 * @param source - The compiled ES module source text (posted in by the host).
 * @throws if the module has no default export or the default is not a function.
 */
export async function loadModule(
  source: string,
): Promise<ComponentType<Record<string, unknown>>> {
  const rewritten = rewriteImports(source);

  const blob = new Blob([rewritten], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const module = await import(/* @vite-ignore */ blobUrl);

    if (!module.default) {
      throw new Error("Module does not export a default component");
    }
    if (typeof module.default !== "function") {
      throw new Error("Module default export is not a valid React component");
    }

    return module.default as ComponentType<Record<string, unknown>>;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
