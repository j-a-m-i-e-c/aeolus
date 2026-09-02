import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  AutomationProjectCompileError,
  compileAutomationProject,
  readAutomationProject,
  saveAutomationProject,
} from "./automation-project.js";
import { automationProjects } from "../db/migrations/015-automation-projects.js";

describe("Automation Projects", () => {
  it("bundles relative Logic modules and adds the completion wrapper internally", async () => {
    const compiled = await compileAutomationProject({
      files: [
        {
          path: "logic/index.ts",
          content: `import { message } from "./message";\nexport default async function run(context: EventContext) { log.info(message + context.topic); }`,
        },
        { path: "logic/message.ts", content: `export const message = "topic:";` },
      ],
    });

    expect(compiled.logicSource).toContain("export default async function run");
    expect(compiled.compiledJs).toContain("automation({");
    expect(compiled.compiledJs).toContain("topic:");
    expect(compiled.uiEntry).toBeNull();
  });

  it("also bundles legacy helper-style Logic when promoted into a project", async () => {
    const compiled = await compileAutomationProject({
      files: [
        {
          path: "logic/index.ts",
          content: `automation({ actions: [async () => { log.info("legacy helper"); }] });`,
        },
      ],
    });

    expect(compiled.logicSource).toContain("automation({");
    expect(compiled.compiledJs).toContain("legacy helper");
  });

  it("bundles an optional React UI with project-local imports", async () => {
    const compiled = await compileAutomationProject({
      files: [
        { path: "logic/index.ts", content: `export default async function run() { log.info("ok"); }` },
        { path: "ui/index.tsx", content: `import { label } from "./label"; export default function View() { return <div>{label}</div>; }` },
        { path: "ui/label.ts", content: `export const label = "Project UI";` },
      ],
    });

    expect(compiled.uiEntry).toBe("ui/index.tsx");
    expect(compiled.compiledUi).toContain("Project UI");
  });

  it("rejects imports outside the project and non-React package imports", async () => {
    await expect(compileAutomationProject({ files: [
      { path: "logic/index.ts", content: `import "../outside"; export default async function run() {}` },
    ] })).rejects.toBeInstanceOf(AutomationProjectCompileError);

    await expect(compileAutomationProject({ files: [
      { path: "logic/index.ts", content: `import lodash from "lodash"; export default async function run() { log.info(String(lodash)); }` },
    ] })).rejects.toBeInstanceOf(AutomationProjectCompileError);
  });

  it("leaves @aeolus/ui external in a UI bundle so the sandbox runtime supplies it", async () => {
    // Custom UIs cannot use Tailwind classes, so the platform provides its theme
    // and formatting as an importable module rather than leaving every author to
    // hand-roll hex. It must survive bundling as an import, not be inlined.
    const compiled = await compileAutomationProject({
      files: [
        { path: "logic/index.ts", content: `export default async function run() {}` },
        {
          path: "ui/index.tsx",
          content: `import { tokens, percent } from "@aeolus/ui";
export default function View() { return <div style={{ color: tokens.color.text }}>{percent(42)}</div>; }`,
        },
      ],
    });

    expect(compiled.compiledUi).toContain('from "@aeolus/ui"');
  });

  it("still refuses @aeolus/ui from project Logic, which has no UI sandbox", async () => {
    await expect(compileAutomationProject({ files: [
      { path: "logic/index.ts", content: `import { percent } from "@aeolus/ui"; export default async function run() { log.info(percent(1)); }` },
    ] })).rejects.toBeInstanceOf(AutomationProjectCompileError);
  });

  it("rejects a declared UI entry that does not exist", async () => {
    await expect(compileAutomationProject({
      uiEntry: "ui/missing.tsx",
      files: [{ path: "logic/index.ts", content: `export default async function run() {}` }],
    })).rejects.toMatchObject({ details: [expect.objectContaining({ message: expect.stringContaining("UI entry file not found") })] });
  });

  it("persists projects and transparently projects legacy source", async () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      script_source TEXT,
      ui_source TEXT
    )`);
    automationProjects.up(db);

    db.prepare("INSERT INTO automation_rules (id, rule_type, script_source, ui_source) VALUES (?, 'script', ?, ?)")
      .run("legacy", "log.info('legacy')", null);
    expect(readAutomationProject(db, "legacy")).toMatchObject({
      automationId: "legacy",
      legacyProjection: true,
      logicEntry: "logic/index.ts",
    });

    db.prepare("INSERT INTO automation_rules (id, rule_type, script_source, ui_source) VALUES (?, 'script', ?, ?)")
      .run("project", "", null);
    const compiled = await compileAutomationProject({ files: [
      { path: "logic/index.ts", content: `export default async function run() { log.info("project"); }` },
      { path: "shared/value.ts", content: `export const value = 1;` },
    ] });
    saveAutomationProject(db, "project", compiled);
    expect(readAutomationProject(db, "project")).toMatchObject({
      automationId: "project",
      legacyProjection: false,
      logicEntry: "logic/index.ts",
      files: expect.arrayContaining([expect.objectContaining({ path: "shared/value.ts" })]),
    });
    db.close();
  });
});
