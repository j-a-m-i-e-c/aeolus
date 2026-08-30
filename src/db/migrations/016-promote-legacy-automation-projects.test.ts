import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { automationProjects } from "./015-automation-projects.js";
import { promoteLegacyAutomationProjects } from "./016-promote-legacy-automation-projects.js";

describe("migration 016 — promote legacy script automations to projects", () => {
  it("backfills existing script source and UI without touching form rules or existing projects", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE automation_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      script_source TEXT,
      ui_source TEXT,
      created_at INTEGER NOT NULL
    )`);
    automationProjects.up(db);

    db.prepare("INSERT INTO automation_rules VALUES (?, 'script', ?, ?, ?)")
      .run("legacy", `automation({ actions: [async () => log.info("legacy")] });`, `export default function UI(){ return null; }`, 100);
    db.prepare("INSERT INTO automation_rules VALUES (?, 'script', ?, NULL, ?)")
      .run("already-project", `export default async function run(){}`, 200);
    db.prepare("INSERT INTO automation_rules VALUES (?, 'form', NULL, NULL, ?)")
      .run("form", 300);

    db.prepare("INSERT INTO automation_projects VALUES (?, 'logic/index.ts', NULL, ?, ?)")
      .run("already-project", 200, 200);
    db.prepare("INSERT INTO automation_project_files VALUES (?, 'logic/index.ts', ?, ?, ?)")
      .run("already-project", `export default async function run(){ log.info("keep me"); }`, 200, 200);

    promoteLegacyAutomationProjects.up(db);

    const legacyProject = db.prepare("SELECT logic_entry, ui_entry FROM automation_projects WHERE automation_id = 'legacy'").get() as { logic_entry: string; ui_entry: string | null };
    expect(legacyProject).toEqual({ logic_entry: "logic/index.ts", ui_entry: "ui/index.tsx" });

    const legacyFiles = db.prepare("SELECT path, content FROM automation_project_files WHERE automation_id = 'legacy' ORDER BY path").all() as Array<{ path: string; content: string }>;
    expect(legacyFiles.map((file) => file.path)).toEqual(["logic/index.ts", "ui/index.tsx"]);
    expect(legacyFiles[0].content).toContain("automation({");

    const existing = db.prepare("SELECT content FROM automation_project_files WHERE automation_id = 'already-project' AND path = 'logic/index.ts'").get() as { content: string };
    expect(existing.content).toContain("keep me");
    expect(db.prepare("SELECT 1 FROM automation_projects WHERE automation_id = 'form'").get()).toBeUndefined();

    // Re-running is safe and does not replace authored files.
    promoteLegacyAutomationProjects.up(db);
    const existingAgain = db.prepare("SELECT content FROM automation_project_files WHERE automation_id = 'already-project' AND path = 'logic/index.ts'").get() as { content: string };
    expect(existingAgain.content).toContain("keep me");

    db.close();
  });
});
