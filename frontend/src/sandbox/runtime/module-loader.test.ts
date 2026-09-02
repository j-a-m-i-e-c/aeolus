// frontend/src/sandbox/runtime/module-loader.test.ts — Tests for in-frame rewriteImports
// Retargeted from the original useDynamicComponent.test.ts to validate rewrites
// against globalThis.__SANDBOX_EXTERNALS__ instead of window.__AEOLUS_EXTERNALS__.

import { describe, it, expect } from "vitest";
import { rewriteImports, EXTERNAL_SPECIFIERS, SANDBOX_EXTERNALS_GLOBAL } from "./module-loader";

const G = `globalThis.${SANDBOX_EXTERNALS_GLOBAL}`;

describe("rewriteImports (sandbox-targeted)", () => {
  it("rewrites named React imports to sandbox externals", () => {
    const out = rewriteImports(`import { useState, useEffect } from "react";`);
    expect(out).toBe(`const { useState, useEffect } = ${G}["react"];`);
  });

  it("converts 'as' aliases to destructuring syntax", () => {
    const out = rewriteImports(`import { jsx as _jsx } from "react/jsx-runtime";`);
    expect(out).toBe(`const { jsx: _jsx } = ${G}["react/jsx-runtime"];`);
  });

  it("rewrites a default import using the default-or-namespace fallback", () => {
    const out = rewriteImports(`import React from "react";`);
    expect(out).toContain(`${G}["react"].default || ${G}["react"]`);
    expect(out).toContain("const React =");
  });

  it("rewrites a namespace import", () => {
    const out = rewriteImports(`import * as React from "react";`);
    expect(out).toBe(`const React = ${G}["react"];`);
  });

  it("handles a combined default + named import", () => {
    const out = rewriteImports(`import React, { useState } from "react";`);
    expect(out).toContain("const React =");
    expect(out).toContain(`const { useState } = ${G}["react"];`);
  });

  it("rewrites react-dom imports", () => {
    const out = rewriteImports(`import { createRoot } from "react-dom";`);
    expect(out).toBe(`const { createRoot } = ${G}["react-dom"];`);
  });

  it("leaves non-external imports untouched", () => {
    const src = `import { foo } from "./local-module";`;
    expect(rewriteImports(src)).toBe(src);
  });

  it("handles single-quoted specifiers", () => {
    const out = rewriteImports(`import { useState } from 'react';`);
    expect(out).toBe(`const { useState } = ${G}["react"];`);
  });

  it("rewrites multiple imports in sequence", () => {
    const src = [
      `import { useState } from "react";`,
      `import { jsx as _jsx } from "react/jsx-runtime";`,
      `import { createRoot } from "react-dom";`,
    ].join("\n");
    const out = rewriteImports(src);
    expect(out).toContain(`const { useState } = ${G}["react"];`);
    expect(out).toContain(`const { jsx: _jsx } = ${G}["react/jsx-runtime"];`);
    expect(out).toContain(`const { createRoot } = ${G}["react-dom"];`);
  });

  it("does NOT reference window.__AEOLUS_EXTERNALS__", () => {
    const out = rewriteImports(`import { useState } from "react";`);
    expect(out).not.toContain("__AEOLUS_EXTERNALS__");
    expect(out).toContain(SANDBOX_EXTERNALS_GLOBAL);
  });

  it("rewrites the @aeolus/ui design-token module", () => {
    const out = rewriteImports(`import { tokens, control } from "@aeolus/ui";`);
    expect(out).toBe(`const { tokens, control } = ${G}["@aeolus/ui"];`);
  });

  it("rewrites a namespace import of @aeolus/ui", () => {
    const out = rewriteImports(`import * as ui from "@aeolus/ui";`);
    expect(out).toBe(`const ui = ${G}["@aeolus/ui"];`);
  });

  it("prefers the longest matching specifier so react does not shadow react/jsx-runtime", () => {
    // The matcher is generated from EXTERNAL_SPECIFIERS; a naive alternation could
    // match the "react" prefix and leave "/jsx-runtime" stranded in the output.
    const out = rewriteImports(`import { jsxs } from "react/jsx-runtime";`);
    expect(out).toBe(`const { jsxs } = ${G}["react/jsx-runtime"];`);
  });

  it("covers every declared external, so the matcher cannot fall behind the set", () => {
    for (const specifier of EXTERNAL_SPECIFIERS) {
      const out = rewriteImports(`import * as dep from "${specifier}";`);
      expect(out).toBe(`const dep = ${G}["${specifier}"];`);
    }
  });

  it("leaves an undeclared scoped package untouched", () => {
    const src = `import { thing } from "@other/pkg";`;
    expect(rewriteImports(src)).toBe(src);
  });

  it("leaves no bare import in a realistic compiled project UI bundle", () => {
    // Verbatim shape emitted by the project compiler's esbuild pass for a UI that
    // imports both React and @aeolus/ui. The compiler marking a specifier external
    // and this loader rewriting it are two separate lists; anything left as a bare
    // import here reaches the frame's blob URL and fails to resolve at runtime.
    const compiled = [
      `// aeolus-project:ui/index.tsx`,
      `import { tokens, percent, control } from "@aeolus/ui";`,
      `import { useState } from "react";`,
      `import { jsx } from "react/jsx-runtime";`,
      `function View() {`,
      `  const [n] = useState(1);`,
      `  return /* @__PURE__ */ jsx("button", { ...control({ disabled: true }), children: percent(n) });`,
      `}`,
      `var aeolus_entry_default = View;`,
      `export {`,
      `  aeolus_entry_default as default`,
      `};`,
    ].join("\n");

    const out = rewriteImports(compiled);

    expect(out).not.toMatch(/^\s*import\s/m);
    expect(out).toContain(`const { tokens, percent, control } = ${G}["@aeolus/ui"];`);
    expect(out).toContain(`const { useState } = ${G}["react"];`);
    expect(out).toContain(`const { jsx } = ${G}["react/jsx-runtime"];`);
    // The component body must survive untouched.
    expect(out).toContain("aeolus_entry_default as default");
  });
});
