// src/api/routes/automation-project.routes.test.ts
//
// Atomicity of Automation Project saves, against a REAL SQLite database.
//
// A project save writes to two places: the authored tree
// (automation_projects / automation_project_files) and the legacy runtime
// projection on automation_rules (script_source, compiled_js, ui_source,
// compiled_ui). Those must move together. The intended order is:
//
//   validate files → compile whole project → BEGIN → save tree + projection → COMMIT
//
// so a compile failure must leave a previously working project completely
// intact rather than half-updated. These tests assert that end state, not the
// implementation, and they use a real database because the guarantee depends on
// real transaction semantics.

import Database from "better-sqlite3";
import express from "express";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initSchema } from "../../db/database.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createAutomationRoutes } from "./automation.routes.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Auth is exercised elsewhere; these tests are about write atomicity.
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../core/event-bus.js", () => ({
  eventBus: { emit: vi.fn() },
  AUTOMATION_STATE_CHANGE: "automation:state-change",
}));

const RULE_ID = "rule-project";

/** The projection columns the runtime actually consumes. */
interface Projection {
  script_source: string | null;
  compiled_js: string | null;
  ui_source: string | null;
  compiled_ui: string | null;
}

let db: InstanceType<typeof Database>;
let app: express.Express;

/** A project that compiles: logic imports a sibling, UI imports a sibling. */
function workingProject() {
  return {
    logicEntry: "logic/index.ts",
    uiEntry: "ui/index.tsx",
    files: [
      { path: "logic/index.ts", content: `import { LABEL } from "./constants";\nexport default async function run() { log.info(LABEL); }` },
      { path: "logic/constants.ts", content: `export const LABEL = "working-v1";` },
      { path: "ui/index.tsx", content: `export default function View() { return <div>ui-v1</div>; }` },
    ],
  };
}

function readProjection(): Projection {
  return db.prepare("SELECT script_source, compiled_js, ui_source, compiled_ui FROM automation_rules WHERE id = ?").get(RULE_ID) as Projection;
}

function readFiles(): Array<{ path: string; content: string }> {
  return db.prepare("SELECT path, content FROM automation_project_files WHERE automation_id = ? ORDER BY path").all(RULE_ID) as Array<{ path: string; content: string }>;
}

async function put(body: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const res = await fetch(`http://127.0.0.1:${address.port}/api/automations/${RULE_ID}/project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);

  db.prepare(
    `INSERT INTO automation_rules (id, name, trigger_topic, condition_type, condition_value, action_type, action_target, action_params, rule_type, script_source, compiled_js, structured_metadata, ui_source, compiled_ui, trigger_type, enabled, created_at)
     VALUES (?, 'Project Rule', 'sensor/x', NULL, NULL, 'script', '', '{}', 'script', NULL, NULL, NULL, NULL, NULL, 'mqtt', 0, 0)`,
  ).run(RULE_ID);

  const engine = { listRules: () => [], register: vi.fn(), unregister: vi.fn(), getRule: () => null } as any;
  const router = createAutomationRoutes(
    engine,
    db as any,
    { getDevice: vi.fn(), listDevices: () => [] } as any,
    { execute: vi.fn() } as any,
    { getEntries: () => [] } as any,
    "/tmp/sandbox-types.d.ts",
    () => (_req: any, _res: any, next: any) => next(),
    {
      hasResourcePermission: () => true,
      filterByPermission: (_u: string, _k: string, ids: string[]) => ids,
      effectivePermission: () => "write",
    } as any,
  );

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { id: "admin", role: "admin" }; next(); });
  app.use("/api/automations", router);
  app.use(errorHandler);
});

afterEach(() => db.close());

describe("PUT /api/automations/:id/project — write atomicity", () => {
  it("stores the authored tree and the compiled projection together on success", async () => {
    const res = await put(workingProject());
    expect(res.status).toBe(200);

    const projection = readProjection();
    // Authored logic entry is mirrored into script_source; compiled_js is the
    // bundle the sandbox runs, so it carries the imported sibling's value.
    expect(projection.script_source).toContain("export default async function run");
    expect(projection.compiled_js).toContain("working-v1");
    expect(projection.compiled_js).toContain("automation({");
    expect(projection.ui_source).toContain("ui-v1");
    expect(projection.compiled_ui).toContain("ui-v1");

    expect(readFiles().map((f) => f.path)).toEqual(["logic/constants.ts", "logic/index.ts", "ui/index.tsx"]);
  });

  // The core guarantee: a failed compile is a no-op, not a partial write.
  it.each([
    [
      "a syntax error in a non-entry logic module",
      {
        logicEntry: "logic/index.ts",
        uiEntry: "ui/index.tsx",
        files: [
          { path: "logic/index.ts", content: `import { LABEL } from "./constants";\nexport default async function run() { log.info(LABEL); }` },
          { path: "logic/constants.ts", content: `export const LABEL = ;` },
          { path: "ui/index.tsx", content: `export default function View() { return <div>ui-v2</div>; }` },
        ],
      },
    ],
    [
      "an import that escapes the project root",
      {
        logicEntry: "logic/index.ts",
        files: [
          { path: "logic/index.ts", content: `import "../../secrets";\nexport default async function run() {}` },
        ],
      },
    ],
    [
      "a forbidden npm package import",
      {
        logicEntry: "logic/index.ts",
        files: [
          { path: "logic/index.ts", content: `import fs from "node:fs";\nexport default async function run() { log.info(String(fs)); }` },
        ],
      },
    ],
    [
      "a missing relative import target",
      {
        logicEntry: "logic/index.ts",
        files: [
          { path: "logic/index.ts", content: `import { gone } from "./not-here";\nexport default async function run() { log.info(gone); }` },
        ],
      },
    ],
    [
      "a UI module that fails to compile",
      {
        logicEntry: "logic/index.ts",
        uiEntry: "ui/index.tsx",
        files: [
          { path: "logic/index.ts", content: `export default async function run() { log.info("fine"); }` },
          { path: "ui/index.tsx", content: `export default function View() { return <div>unclosed; }` },
        ],
      },
    ],
  ])("leaves the previous project completely intact when the save fails on %s", async (_case, broken) => {
    await put(workingProject());
    const projectionBefore = readProjection();
    const filesBefore = readFiles();

    const res = await put(broken);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // Neither half of the write may have moved.
    expect(readProjection()).toEqual(projectionBefore);
    expect(readFiles()).toEqual(filesBefore);

    // Specifically: nothing from the rejected attempt leaked in, and the
    // still-installed bundle is the old working one.
    expect(readProjection().compiled_js).toContain("working-v1");
    expect(readFiles().some((f) => f.content.includes("ui-v2"))).toBe(false);
    expect(readFiles().some((f) => f.path === "logic/not-here.ts")).toBe(false);
  });

  it("reports a useful compile failure rather than a bare 500", async () => {
    await put(workingProject());
    const res = await put({
      logicEntry: "logic/index.ts",
      files: [{ path: "logic/index.ts", content: `export default async function run() { const x = ; }` }],
    });

    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toMatch(/compilation failed/i);
    // Details carry a location so the editor can put the marker on a line.
    expect(Array.isArray(res.body?.details)).toBe(true);
    expect(res.body.details[0]).toMatchObject({ line: expect.any(Number), message: expect.any(String) });
  });

  it("does not create a project row at all when the very first save fails", async () => {
    const res = await put({
      logicEntry: "logic/index.ts",
      files: [{ path: "logic/index.ts", content: `import "./missing";\nexport default async function run() {}` }],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(db.prepare("SELECT COUNT(*) AS n FROM automation_projects WHERE automation_id = ?").get(RULE_ID)).toEqual({ n: 0 });
    expect(readFiles()).toEqual([]);
    const projection = readProjection();
    expect(projection.script_source).toBeNull();
    expect(projection.compiled_js).toBeNull();
    expect(projection.compiled_ui).toBeNull();
  });

  it("replaces the tree wholesale on a successful save, leaving no removed files behind", async () => {
    await put(workingProject());
    expect(readFiles().map((f) => f.path)).toContain("logic/constants.ts");

    // A second, valid project that no longer contains logic/constants.ts.
    const res = await put({
      logicEntry: "logic/index.ts",
      uiEntry: null,
      files: [{ path: "logic/index.ts", content: `export default async function run() { log.info("working-v2"); }` }],
    });
    expect(res.status).toBe(200);

    expect(readFiles().map((f) => f.path)).toEqual(["logic/index.ts"]);
    const projection = readProjection();
    expect(projection.compiled_js).toContain("working-v2");
    expect(projection.compiled_js).not.toContain("working-v1");
    // Dropping the UI entry must clear the compiled UI, not leave the old one.
    expect(projection.ui_source).toBeNull();
    expect(projection.compiled_ui).toBeNull();
  });
});
