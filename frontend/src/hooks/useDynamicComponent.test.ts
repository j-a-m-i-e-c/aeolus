// frontend/src/hooks/useDynamicComponent.test.ts — Tests for import rewriting + the loader hook

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { rewriteImports, useDynamicComponent } from "./useDynamicComponent";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);

describe("rewriteImports", () => {
  it("rewrites named React imports to globals", () => {
    const out = rewriteImports(`import { useState, useEffect } from "react";`);
    expect(out).toBe(`const { useState, useEffect } = window.__AEOLUS_EXTERNALS__["react"];`);
  });

  it("converts 'as' aliases to destructuring syntax", () => {
    const out = rewriteImports(`import { jsx as _jsx } from "react/jsx-runtime";`);
    expect(out).toBe(`const { jsx: _jsx } = window.__AEOLUS_EXTERNALS__["react/jsx-runtime"];`);
  });

  it("rewrites a default import using the default-or-namespace fallback", () => {
    const out = rewriteImports(`import React from "react";`);
    expect(out).toContain(`window.__AEOLUS_EXTERNALS__["react"].default || window.__AEOLUS_EXTERNALS__["react"]`);
    expect(out).toContain("const React =");
  });

  it("rewrites a namespace import", () => {
    const out = rewriteImports(`import * as React from "react";`);
    expect(out).toBe(`const React = window.__AEOLUS_EXTERNALS__["react"];`);
  });

  it("handles a combined default + named import", () => {
    const out = rewriteImports(`import React, { useState } from "react";`);
    expect(out).toContain("const React =");
    expect(out).toContain(`const { useState } = window.__AEOLUS_EXTERNALS__["react"];`);
  });

  it("rewrites react-dom imports", () => {
    const out = rewriteImports(`import { createRoot } from "react-dom";`);
    expect(out).toBe(`const { createRoot } = window.__AEOLUS_EXTERNALS__["react-dom"];`);
  });

  it("leaves non-external imports untouched", () => {
    const src = `import { foo } from "./local-module";`;
    expect(rewriteImports(src)).toBe(src);
  });
});

describe("useDynamicComponent", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it("stays idle when there is no UI source", () => {
    const { result } = renderHook(() => useDynamicComponent("rule-1", false));
    expect(result.current.Component).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it("surfaces an error when the module endpoint returns non-ok", async () => {
    mockAuthFetch.mockResolvedValue(new Response("", { status: 404 }));

    const { result } = renderHook(() => useDynamicComponent("rule-1", true));

    await waitFor(() => expect(result.current.error).toBe("Failed to load UI module (404)"));
    expect(result.current.Component).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("fetches the automation UI-module URL by default", async () => {
    mockAuthFetch.mockResolvedValue(new Response("", { status: 500 }));

    renderHook(() => useDynamicComponent("rule-42", true));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    expect(String(mockAuthFetch.mock.calls[0][0])).toBe(
      "http://test.local:3001/api/automations/rule-42/ui-module",
    );
  });
});
