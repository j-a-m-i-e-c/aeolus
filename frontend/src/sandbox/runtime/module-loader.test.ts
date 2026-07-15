// frontend/src/sandbox/runtime/module-loader.test.ts — Tests for in-frame rewriteImports
// Retargeted from the original useDynamicComponent.test.ts to validate rewrites
// against globalThis.__SANDBOX_EXTERNALS__ instead of window.__AEOLUS_EXTERNALS__.

import { describe, it, expect } from "vitest";
import { rewriteImports, SANDBOX_EXTERNALS_GLOBAL } from "./module-loader";

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
});
