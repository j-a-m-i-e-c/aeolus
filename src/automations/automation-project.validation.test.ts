// src/automations/automation-project.validation.test.ts — what the project
// compiler refuses.
//
// automation-project.test.ts covers compilation succeeding: relative modules
// bundle, a React UI bundles, `@aeolus/ui` stays external. This file covers the
// refusals, which are a boundary rather than an ergonomic detail. An authored
// project path becomes a key in a virtual filesystem and, on save, a row keyed by
// that path — so "cannot escape its root" and "cannot be a Windows path, an
// absolute path, or contain a null byte" are the rules that keep an Automation
// Project inside itself. The size and count caps are the other half: a project is
// user-submitted input compiled on a Raspberry Pi.
//
// Every refusal is asserted through the public `compileAutomationProject`, because
// that is the only way a project ever arrives.

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  AutomationProjectCompileError,
  DEFAULT_LOGIC_ENTRY,
  DEFAULT_UI_ENTRY,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_FILE_BYTES,
  compileAutomationProject,
  readAutomationProject,
} from "./automation-project.js";
import { automationProjects } from "../db/migrations/015-automation-projects.js";

/** A minimal project that compiles, for mutating one field at a time. */
const validLogic = { path: DEFAULT_LOGIC_ENTRY, content: "export default async function run() {}" };

/** Compile and return the rejection details, failing if it compiled instead. */
async function rejection(project: Parameters<typeof compileAutomationProject>[0]) {
  try {
    await compileAutomationProject(project);
  } catch (error) {
    expect(error, "expected an AutomationProjectCompileError").toBeInstanceOf(AutomationProjectCompileError);
    return (error as AutomationProjectCompileError).details;
  }
  throw new Error("project compiled when it should have been refused");
}

describe("Automation Project path validation", () => {
  it("refuses a backslash path, which is not a project path even on Windows", async () => {
    // Project paths are POSIX keys in a virtual filesystem. Accepting a backslash
    // would make `logic\index.ts` and `logic/index.ts` two names for one intent,
    // and only one of them resolvable by an import.
    const details = await rejection({ files: [validLogic, { path: "logic\\helper.ts", content: "" }] });
    expect(details[0]!.message).toContain("Invalid project path");
  });

  it("refuses an absolute path", async () => {
    const details = await rejection({ files: [validLogic, { path: "/etc/passwd.ts", content: "" }] });
    expect(details[0]!.message).toContain("Invalid project path");
  });

  it("refuses a path containing a null byte", async () => {
    const details = await rejection({ files: [validLogic, { path: "logic/a\0b.ts", content: "" }] });
    expect(details[0]!.message).toContain("Invalid project path");
  });

  it("names an empty path as empty rather than reporting nothing", async () => {
    const details = await rejection({ files: [{ path: "", content: "" }] });
    expect(details[0]!.message).toContain("<empty>");
  });

  it("refuses a path that climbs out of the project root", async () => {
    const details = await rejection({ files: [validLogic, { path: "../secrets.ts", content: "" }] });
    expect(details[0]!.message).toContain("escapes its root");
  });

  it("refuses a path that climbs out part-way along", async () => {
    const details = await rejection({ files: [validLogic, { path: "logic/../../secrets.ts", content: "" }] });
    expect(details[0]!.message).toContain("escapes its root");
  });

  it("refuses a path that normalises to the root itself", async () => {
    const details = await rejection({ files: [{ path: ".", content: "" }] });
    expect(details[0]!.message).toContain("escapes its root");
  });

  it("refuses a file type it cannot compile", async () => {
    const details = await rejection({ files: [validLogic, { path: "logic/notes.md", content: "# notes" }] });
    expect(details[0]!.message).toContain("Unsupported project file type: .md");
    expect(details[0]!.path).toBe("logic/notes.md");
  });

  it("names the absence of an extension rather than reporting an empty type", async () => {
    const details = await rejection({ files: [validLogic, { path: "logic/Makefile", content: "" }] });
    expect(details[0]!.message).toContain("<none>");
  });

  it("accepts every extension it claims to support", async () => {
    const compiled = await compileAutomationProject({
      files: [
        { path: DEFAULT_LOGIC_ENTRY, content: `import { a } from "../shared/a.js";\nimport { b } from "../shared/b.jsx";\nimport c from "../shared/c.json";\nexport default async function run() { log.info(String(a + b + c.n)); }` },
        { path: "shared/a.js", content: "export const a = 1;" },
        { path: "shared/b.jsx", content: "export const b = 2;" },
        { path: "shared/c.json", content: '{ "n": 3 }' },
      ],
    });
    expect(compiled.compiledJs).toContain("automation(");
  });
});

describe("Automation Project size and shape limits", () => {
  it("refuses a project with no files", async () => {
    const details = await rejection({ files: [] });
    expect(details[0]!.message).toContain("at least one source file");
  });

  it("refuses a files value that is not a list", async () => {
    const details = await rejection({ files: undefined as never });
    expect(details[0]!.message).toContain("at least one source file");
  });

  it("refuses more files than the cap allows", async () => {
    const files = [validLogic];
    for (let i = 0; i < MAX_PROJECT_FILES; i++) files.push({ path: `shared/f${i}.ts`, content: "" });
    const details = await rejection({ files });
    expect(details[0]!.message).toContain(`exceeds ${MAX_PROJECT_FILES} files`);
  });

  it("refuses a single file above the per-file cap", async () => {
    const details = await rejection({
      files: [validLogic, { path: "shared/big.ts", content: "x".repeat(MAX_PROJECT_FILE_BYTES + 1) }],
    });
    expect(details[0]!.message).toContain(`exceeds ${MAX_PROJECT_FILE_BYTES} bytes`);
    expect(details[0]!.path).toBe("shared/big.ts");
  });

  it("refuses a project whose files are individually fine but collectively too large", async () => {
    const chunk = "x".repeat(MAX_PROJECT_FILE_BYTES);
    const files = [validLogic];
    for (let i = 0; i <= Math.ceil(MAX_PROJECT_BYTES / MAX_PROJECT_FILE_BYTES); i++) {
      files.push({ path: `shared/f${i}.ts`, content: chunk });
    }
    const details = await rejection({ files });
    expect(details[0]!.message).toContain(`exceeds ${MAX_PROJECT_BYTES} bytes`);
  });

  it("refuses the same path twice, rather than letting one copy win silently", async () => {
    const details = await rejection({
      files: [validLogic, { path: "shared/a.ts", content: "export const a = 1;" }, { path: "shared/a.ts", content: "export const a = 2;" }],
    });
    expect(details[0]!.message).toContain("Duplicate project file: shared/a.ts");
  });

  it("treats a missing file content as empty rather than as the text 'undefined'", async () => {
    const compiled = await compileAutomationProject({
      files: [validLogic, { path: "shared/empty.ts", content: undefined as never }],
    });
    expect(compiled.files.find((f) => f.path === "shared/empty.ts")?.content).toBe("");
  });

  it("refuses a project whose declared Logic entry is not among its files", async () => {
    const details = await rejection({
      files: [{ path: "logic/other.ts", content: "export default async function run() {}" }],
    });
    expect(details[0]!.message).toContain("Logic entry file not found: logic/index.ts");
  });
});

describe("Automation Project compilation failures", () => {
  it("reports the file and position of a syntax error", async () => {
    const details = await rejection({
      files: [{ path: DEFAULT_LOGIC_ENTRY, content: "export default async function run() { const x = ;" }],
    });
    expect(details.length).toBeGreaterThan(0);
    expect(details[0]!.line).toBeGreaterThanOrEqual(1);
    expect(details[0]!.column).toBeGreaterThanOrEqual(0);
    expect(details[0]!.message).toBeTruthy();
  });

  it("refuses a bare package import from Logic, naming the rule rather than the bundler's wording", async () => {
    const details = await rejection({
      files: [{ path: DEFAULT_LOGIC_ENTRY, content: `import fs from "node:fs";\nexport default async function run() { log.info(String(fs)); }` }],
    });
    expect(details.some((d) => d.message.includes("Only relative project imports are allowed"))).toBe(true);
  });

  it("tells a UI author which specifiers the sandbox does provide", async () => {
    const details = await rejection({
      files: [
        validLogic,
        // The binding is used, so the import cannot be tree-shaken away before
        // the resolver ever sees the specifier.
        { path: DEFAULT_UI_ENTRY, content: `import lodash from "lodash";\nexport default function C() { return lodash.noop(); }` },
      ],
    });
    expect(details.some((d) => d.message.includes('the UI sandbox provides "react"'))).toBe(true);
  });

  it("refuses a relative import that resolves outside the project", async () => {
    const details = await rejection({
      files: [{ path: DEFAULT_LOGIC_ENTRY, content: `import { x } from "../../outside.js";\nexport default async function run() { log.info(String(x)); }` }],
    });
    expect(details.some((d) => d.message.includes("escapes Automation Project"))).toBe(true);
  });

  it("refuses a relative import with no matching file", async () => {
    const details = await rejection({
      files: [{ path: DEFAULT_LOGIC_ENTRY, content: `import { x } from "./missing.js";\nexport default async function run() { log.info(String(x)); }` }],
    });
    expect(details.some((d) => d.message.includes("Project import not found"))).toBe(true);
  });
});

describe("readAutomationProject", () => {
  function makeDb() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      script_source TEXT,
      ui_source TEXT
    )`);
    automationProjects.up(db);
    return db;
  }

  it("returns null for an automation that does not exist", () => {
    expect(readAutomationProject(makeDb(), "nope")).toBeNull();
  });

  it("projects a legacy automation that has a UI blob as a two-file project", () => {
    const db = makeDb();
    db.prepare("INSERT INTO automation_rules (id, rule_type, script_source, ui_source) VALUES (?, 'script', ?, ?)")
      .run("legacy-ui", "log.info('legacy')", "export default function C() { return null; }");

    const project = readAutomationProject(db, "legacy-ui");
    expect(project?.legacyProjection).toBe(true);
    expect(project?.uiEntry).toBe(DEFAULT_UI_ENTRY);
    expect(project?.files.map((f) => f.path)).toEqual([DEFAULT_LOGIC_ENTRY, DEFAULT_UI_ENTRY]);
  });

  it("projects a legacy automation with no source at all as an empty project", () => {
    // A form rule has neither blob. It still exists, so the answer is an empty
    // project rather than null, which would mean "no such automation".
    const db = makeDb();
    db.prepare("INSERT INTO automation_rules (id, rule_type, script_source, ui_source) VALUES (?, 'form', NULL, NULL)")
      .run("form-rule");

    const project = readAutomationProject(db, "form-rule");
    expect(project).toMatchObject({ automationId: "form-rule", files: [], uiEntry: null, legacyProjection: true });
  });
});
