// src/project-api/api-compiler.test.ts — the API bundle contains only what the
// manifest names and what api/ and lib/ import, and compiling it runs nothing.

import { describe, expect, it } from "vitest";
import { AutomationProjectCompileError, compileAutomationProject, type AutomationProjectFile } from "../automations/automation-project.js";
import { API_HANDLER_TABLE, compileProjectApi } from "./api-compiler.js";

const ROUTES = JSON.stringify({
  version: 1,
  routes: [{ id: "tank", method: "GET", path: "/tanks/:id", handler: "getTank", response: { type: "object" } }],
});
const LOGIC = `export default function run() { state.set("ran", "LOGIC_MARKER"); }`;

function project(extra: Record<string, string> = {}): AutomationProjectFile[] {
  const files: Record<string, string> = {
    "logic/index.ts": LOGIC,
    "api/routes.json": ROUTES,
    "api/handlers.ts": `export function getTank() { return { ok: true }; }`,
    ...extra,
  };
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

async function compileErrors(files: AutomationProjectFile[]): Promise<string> {
  try {
    await compileProjectApi(files);
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationProjectCompileError);
    return (error as AutomationProjectCompileError).details.map((d) => `${d.path ?? ""}:${d.line} ${d.message}`).join("\n");
  }
  throw new Error("expected the API to be rejected");
}

describe("compileProjectApi", () => {
  it("returns null for a project that declares no API, which stays exactly as before", async () => {
    const files = [{ path: "logic/index.ts", content: LOGIC }];
    expect(await compileProjectApi(files)).toBeNull();
    // The existing compiler is untouched by this module.
    await expect(compileAutomationProject({ files })).resolves.toMatchObject({ logicEntry: "logic/index.ts" });
  });

  it("bundles the declared handler without the project's Logic", async () => {
    const api = await compileProjectApi(project());
    expect(api?.routes.map((r) => r.id)).toEqual(["tank"]);
    expect(api?.bundle).toContain(API_HANDLER_TABLE);
    expect(api?.bundle).not.toContain("LOGIC_MARKER");
    expect(api?.bundle).not.toContain("automation(");
  });

  it("leaves out exports the manifest does not name", async () => {
    const api = await compileProjectApi(project({
      "api/handlers.ts": `export function getTank() { return 1; }\nexport function adminOnly() { return "SECRET_EXPORT"; }`,
    }));
    expect(api?.bundle).not.toContain("SECRET_EXPORT");
  });

  it("follows imports into api/ and lib/, including JSON", async () => {
    const api = await compileProjectApi(project({
      "api/handlers.ts": `import { label } from "../lib/format";\nimport units from "./units.json";\nexport function getTank() { return label(units.level); }`,
      "api/units.json": `{ "level": "%" }`,
      "lib/format.ts": `export const label = (unit: string) => "level in " + unit;`,
    }));
    expect(api?.bundle).toContain("level in ");
  });

  it("hashes what it approves: the hash changes when shared code changes", async () => {
    const withLib = (body: string) => project({
      "api/handlers.ts": `import { value } from "../lib/v";\nexport function getTank() { return value; }`,
      "lib/v.ts": `export const value = ${body};`,
    });
    const first = await compileProjectApi(withLib("1"));
    const again = await compileProjectApi(withLib("1"));
    const changed = await compileProjectApi(withLib("2"));
    expect(first?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(again?.contentHash).toBe(first?.contentHash);
    expect(changed?.contentHash).not.toBe(first?.contentHash);
  });

  it("fails to compile when a declared handler is not exported", async () => {
    const errors = await compileErrors(project({ "api/handlers.ts": `export function other() { return 1; }` }));
    expect(errors).toMatch(/getTank/);
  });

  it.each([
    ["Logic", `import "../logic/index";`, /outside them/],
    ["UI", `import "../ui/index";`, /outside them/],
    // Used, because TypeScript drops an unused import before it is resolved.
    ["a package", `import fs from "fs";\nexport const used = fs;`, /not packages/],
    ["a URL", `import x from "https://example.com/x.js";\nexport const used = x;`, /not packages/],
    ["a dynamic import", `export const later = () => import("fs");`, /not packages/],
    ["a path outside the project", `import "../../etc/passwd";`, /escapes|not found/],
    ["a missing file", `import "./nope";`, /not found/],
  ])("refuses an import of %s", async (_label, line, message) => {
    const files = project({ "api/handlers.ts": `${line}\nexport function getTank() { return 1; }`, "ui/index.tsx": `export default () => null;` });
    expect(await compileErrors(files)).toMatch(message);
  });

  it("checks the whole import graph: lib/ may not reach into logic/ on API's behalf", async () => {
    const errors = await compileErrors(project({
      "api/handlers.ts": `import { helper } from "../lib/helper";\nexport function getTank() { return helper(); }`,
      "lib/helper.ts": `import "../logic/index";\nexport const helper = () => 1;`,
    }));
    expect(errors).toMatch(/logic\/index\.ts is outside them/);
    expect(errors).toMatch(/^lib\/helper\.ts:1 /m);
  });

  it("refuses a .tsx file even inside api/", async () => {
    const errors = await compileErrors(project({
      "api/handlers.ts": `import V from "./view.tsx";\nexport function getTank() { return V; }`,
      "api/view.tsx": `export default 1;`,
    }));
    expect(errors).toMatch(/only import \.ts, \.js or \.json/);
  });

  it("requires a manifest for handlers and handlers for a manifest", async () => {
    expect(await compileErrors([{ path: "api/handlers.ts", content: "export const x = 1;" }])).toMatch(/no api\/routes\.json/);
    expect(await compileErrors([{ path: "api/routes.json", content: ROUTES }])).toMatch(/Handlers file not found/);
  });

  it("reports a syntax error in a handler with its file and line", async () => {
    const errors = await compileErrors(project({ "api/handlers.ts": `export function getTank() {\n  return {;\n}` }));
    expect(errors).toMatch(/^api\/handlers\.ts:2 /m);
  });

  it("never executes author code while compiling", async () => {
    // A top-level throw would surface here if compilation evaluated anything.
    const api = await compileProjectApi(project({
      "api/handlers.ts": `throw new Error("ran at compile time");\nexport function getTank() { return 1; }`,
    }));
    expect(api?.bundle).toContain("ran at compile time");
  });
});
