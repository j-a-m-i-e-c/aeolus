// src/api/routes/automation.routes.branches.test.ts — the decision paths the
// happy-path route suite does not reach.
//
// automation.routes.test.ts covers the contract: create, update, delete, toggle,
// fire, read. This file covers the branches either side of those — trigger-config
// resolution for every trigger type, the PATCH-style field merges, the fallbacks
// for rows written before a column existed, and the failure paths of each route.
//
// Two of these are not merely uncovered but untested behaviour: `shared-state`
// trigger validation has no route-level test at all, and neither does the
// Automation Project sub-resource.
//
// Deliberately NOT tested here: `if (!name)` in POST, `if (!key)` in PUT state and
// the trigger-type membership check in resolveTriggerConfig. Zod rejects all three
// before the handler runs, so they are unreachable through HTTP and only
// defensible as defence in depth. Reaching them would mean bypassing the schema,
// which would test a request the server cannot receive.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import { createAutomationRoutes, loadUiRules } from "./automation.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  AutomationProjectCompileError,
  compileAutomationProject,
  readAutomationProject,
  saveAutomationProject,
} from "../../automations/automation-project.js";
import { buildSnippetCatalog } from "../../automations/snippet-catalog.js";
import { transpileUi } from "../../automations/transpiler.js";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService } from "../../automations/command-service.js";
import type { ExecutionLog } from "../../automations/execution-log.js";
import type { AutomationStateStore } from "../../automations/automation-state-store.js";
import type { ConditionRegistry } from "../../automations/condition-registry.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import type Database from "better-sqlite3";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Auth is exercised by the resource-authorization suites. Here every guard is a
// passthrough and `req.user` is injected per test, so a route's own admin/read
// decisions are what is under test.
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../automations/transpiler.js", () => ({
  transpile: vi.fn((source: string) => ({ success: true, js: `compiled:${source}` })),
  transpileUi: vi.fn((source: string) => ({ success: true, js: `ui-compiled:${source}` })),
}));

// Real esbuild compilation is covered by the Automation Project compiler suite.
vi.mock("../../automations/automation-project.js", () => {
  class AutomationProjectCompileError extends Error {
    constructor(public details: unknown[]) {
      super("Automation Project compilation failed");
    }
  }
  return {
    AutomationProjectCompileError,
    compileAutomationProject: vi.fn(async (project: any) => {
      const logicEntry = project.logicEntry || "logic/index.ts";
      const logicSource = project.files.find((f: any) => f.path === logicEntry)?.content ?? "";
      return {
        compiledJs: `compiled:${logicSource}`,
        compiledUi: null,
        logicSource,
        uiSource: null,
        files: project.files,
        logicEntry,
        uiEntry: null,
      };
    }),
    saveAutomationProject: vi.fn(),
    readAutomationProject: vi.fn(() => null),
  };
});

vi.mock("../../automations/structured-metadata-extractor.js", () => ({
  extractStructuredMetadata: vi.fn(() => ({ actions: [], triggers: [] })),
}));

vi.mock("../../automations/snippet-catalog.js", () => ({
  buildSnippetCatalog: vi.fn(() => [{ id: "snippet-1", label: "Test Snippet" }]),
}));

vi.mock("../../automations/cron-utils.js", () => ({
  isValidCron: vi.fn((expr: string) => expr === "* * * * *" || expr === "0 9 * * *"),
}));

vi.mock("../../core/event-bus.js", () => ({
  eventBus: { emit: vi.fn() },
  AUTOMATION_STATE_CHANGE: "automation:state-change",
  DEVICE_STATE_CHANGE: "device:state-change",
}));

// ─── Harness ─────────────────────────────────────────────────────────────────

/** Send one request and resolve with status, parsed body and content type. */
async function request(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  options?: { omitContentType?: boolean },
): Promise<{ status: number; body: any; contentType: string }> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("no server address");
  }
  try {
    const init: RequestInit = { method: method.toUpperCase() };
    if (!options?.omitContentType) init.headers = { "Content-Type": "application/json" };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${addr.port}${url}`, init);
    const contentType = res.headers.get("content-type") || "";
    const parsed = contentType.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, body: parsed, contentType };
  } finally {
    server.close();
  }
}

type Row = Record<string, any>;

/** A stored form rule with every column the routes read. */
function formRow(overrides: Row = {}): Row {
  return {
    id: "rule-form",
    name: "Stored Name",
    trigger_topic: "sensor/stored",
    condition_type: "value_above",
    condition_value: "10",
    action_type: "publish",
    action_target: "cmnd/stored",
    action_params: JSON.stringify({ payload: "ON" }),
    rule_type: "form",
    script_source: null,
    compiled_js: null,
    structured_metadata: null,
    ui_source: "stored-ui",
    compiled_ui: "stored-compiled-ui",
    trigger_type: "mqtt",
    cron_expression: null,
    authored_unrestricted: 0,
    owner_tab_id: "tab-1",
    enabled: 1,
    created_at: 1000,
    ...overrides,
  };
}

/** A stored script rule with a compiled runtime projection. */
function scriptRow(overrides: Row = {}): Row {
  return formRow({
    id: "rule-script",
    rule_type: "script",
    script_source: "export default () => {}",
    compiled_js: "compiled:stored",
    ui_source: null,
    compiled_ui: null,
    action_type: "script",
    action_target: "",
    action_params: "{}",
    ...overrides,
  });
}

function createMockDb() {
  const rows: Row[] = [];
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  let lastSql = "";
  const statement = {
    all: vi.fn(() => rows),
    get: vi.fn((id?: string) => rows.find((r) => r.id === id) ?? undefined),
    run: vi.fn((...args: unknown[]) => {
      runs.push({ sql: lastSql, args });
      return { changes: 1 };
    }),
  };
  return {
    prepare: vi.fn((sql: string) => {
      lastSql = sql;
      return statement;
    }),
    transaction: vi.fn((fn: () => unknown) => fn),
    inTransaction: false,
    _rows: rows,
    _runs: runs,
    /** Arguments of the last write whose SQL contains `fragment`. */
    lastRun(fragment: string) {
      return [...runs].reverse().find((r) => r.sql.includes(fragment));
    },
  };
}

function createMockEngine() {
  return {
    listRules: vi.fn(() => []),
    register: vi.fn(),
    unregister: vi.fn(),
    getRule: vi.fn((_id: string) => null as any),
    fire: vi.fn().mockResolvedValue({ executionId: "exec-1", success: true, commandResults: [] }),
  };
}

function createMockStateStore() {
  const store: Record<string, Record<string, unknown>> = {};
  return {
    getAll: vi.fn((ruleId: string) => store[ruleId] || {}),
    set: vi.fn(() => true),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    loadFromDb: vi.fn(),
  };
}

const permissiveResolver = {
  hasResourcePermission: () => true,
  filterByPermission: (_u: string, _k: string, ids: string[]) => ids,
  effectivePermission: () => "write",
} as any;

const denyingResolver = {
  hasResourcePermission: () => false,
  filterByPermission: () => [],
  effectivePermission: () => "none",
} as any;

// A real directory, because the routes ask the filesystem whether the type
// documents exist rather than taking a flag for it.
const typesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-routes-types-"));
const sandboxTypesFile = path.join(typesDir, "sandbox-types.d.ts");
fs.writeFileSync(sandboxTypesFile, "declare const devices: unknown;");
const missingTypesDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-routes-notypes-"));
const sandboxOnlyFile = path.join(missingTypesDir, "sandbox-types.d.ts");
fs.writeFileSync(sandboxOnlyFile, "declare const state: unknown;");

afterAll(() => {
  fs.rmSync(typesDir, { recursive: true, force: true });
  fs.rmSync(missingTypesDir, { recursive: true, force: true });
});

describe("automation.routes — decision paths", () => {
  let db: ReturnType<typeof createMockDb>;
  let engine: ReturnType<typeof createMockEngine>;
  let stateStore: ReturnType<typeof createMockStateStore>;
  let commandHistoryStore: { listForRule: ReturnType<typeof vi.fn> };
  let executionLog: { list: ReturnType<typeof vi.fn>; getByRuleId: ReturnType<typeof vi.fn> };
  let user: { userId: string; role: string } | undefined;

  interface AppOptions {
    sandboxTypesPath?: string;
    connectorRegistry?: ConnectorRegistry;
    withStateStore?: boolean;
    withCommandHistory?: boolean;
    resolver?: unknown;
  }

  /** Build an app whose optional collaborators match what the test is about. */
  function buildApp(options: AppOptions = {}): express.Express {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (user) (req as any).user = user;
      next();
    });
    app.use(
      "/api/automations",
      createAutomationRoutes(
        engine as unknown as AutomationEngine,
        db as unknown as Database.Database,
        {} as unknown as DeviceRegistry,
        {} as unknown as CommandService,
        executionLog as unknown as ExecutionLog,
        options.sandboxTypesPath ?? "",
        () => (_req: any, _res: any, next: any) => next(),
        (options.resolver ?? permissiveResolver) as any,
        options.connectorRegistry,
        options.withStateStore === false
          ? undefined
          : (stateStore as unknown as AutomationStateStore),
        { buildCondition: vi.fn(() => undefined) } as unknown as ConditionRegistry,
        options.withCommandHistory === false ? undefined : commandHistoryStore,
      ),
    );
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    engine = createMockEngine();
    stateStore = createMockStateStore();
    commandHistoryStore = { listForRule: vi.fn(() => []) };
    executionLog = {
      list: vi.fn(() => [
        { id: "log-1", ruleId: "rule-a", timestamp: 1000, status: "success" },
        { id: "log-2", ruleId: "rule-b", timestamp: 2000, status: "error" },
      ]),
      getByRuleId: vi.fn((ruleId: string) => [
        { id: "log-1", ruleId, timestamp: 1000, status: "success" },
        { id: "log-2", ruleId, timestamp: 2000, status: "error" },
      ]),
    };
    user = undefined;
    vi.mocked(readAutomationProject).mockReturnValue(null as any);
    vi.mocked(transpileUi).mockReturnValue({ success: true, js: "ui-compiled" } as any);
  });

  // ─── Snippets and type documents ───────────────────────────────────────────

  describe("editor support documents", () => {
    it("asks for the UI snippet catalog when the editor is in UI mode", async () => {
      const connectorRegistry = { listAvailable: () => [] } as unknown as ConnectorRegistry;
      const res = await request(buildApp({ connectorRegistry }), "GET", "/api/automations/snippets?mode=ui");
      expect(res.status).toBe(200);
      expect(buildSnippetCatalog).toHaveBeenCalledWith(connectorRegistry, "ui");
    });

    it("treats any other mode as Logic rather than guessing", async () => {
      const connectorRegistry = { listAvailable: () => [] } as unknown as ConnectorRegistry;
      await request(buildApp({ connectorRegistry }), "GET", "/api/automations/snippets?mode=nonsense");
      expect(buildSnippetCatalog).toHaveBeenCalledWith(connectorRegistry, "logic");
    });

    it("serves the sandbox type document as plain text", async () => {
      const res = await request(buildApp({ sandboxTypesPath: sandboxTypesFile }), "GET", "/api/automations/types");
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/plain");
      expect(res.body).toContain("declare const devices");
    });

    it("resolves the UI type document beside the sandbox one", async () => {
      fs.writeFileSync(path.join(typesDir, "ui-types.d.ts"), "declare const aeolus: unknown;");
      const res = await request(buildApp({ sandboxTypesPath: sandboxTypesFile }), "GET", "/api/automations/ui-types");
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/plain");
      expect(res.body).toContain("declare const aeolus");
    });

    it("reports UI types unavailable rather than serving the sandbox document in their place", async () => {
      // Sibling ui-types.d.ts deliberately absent: the path is derived by
      // substitution, so a missing sibling must not fall back to the file that
      // does exist.
      const res = await request(buildApp({ sandboxTypesPath: sandboxOnlyFile }), "GET", "/api/automations/ui-types");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("UI type definitions not available");
    });
  });

  // ─── Automation Project sub-resource ───────────────────────────────────────

  describe("GET /:id/project", () => {
    it("404s when the automation has no authored project", async () => {
      const res = await request(buildApp(), "GET", "/api/automations/rule-script/project");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Automation rule not found");
    });

    it("403s a caller who may not read the automation, even though the project exists", async () => {
      vi.mocked(readAutomationProject).mockReturnValue({ files: [], logicEntry: "logic/index.ts" } as any);
      const res = await request(
        buildApp({ resolver: denyingResolver }),
        "GET",
        "/api/automations/rule-script/project",
      );
      expect(res.status).toBe(403);
    });

    it("returns the authored file tree", async () => {
      const project = { files: [{ path: "logic/index.ts", content: "x" }], logicEntry: "logic/index.ts" };
      vi.mocked(readAutomationProject).mockReturnValue(project as any);
      const res = await request(buildApp(), "GET", "/api/automations/rule-script/project");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(project);
    });
  });

  describe("PUT /:id/project", () => {
    const project = { files: [{ path: "logic/index.ts", content: "export default () => {}" }] };

    it("404s for an automation that does not exist", async () => {
      const res = await request(buildApp(), "PUT", "/api/automations/missing/project", project);
      expect(res.status).toBe(404);
    });

    it("refuses a form rule, which has no project to replace", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form/project", project);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Only script automations");
    });

    it("returns compiler diagnostics when the project does not compile", async () => {
      db._rows.push(scriptRow());
      vi.mocked(compileAutomationProject).mockRejectedValueOnce(
        new AutomationProjectCompileError([{ message: "bad syntax" }]),
      );
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script/project", project);
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ message: "bad syntax" }]);
      expect(saveAutomationProject).not.toHaveBeenCalled();
    });

    it("re-registers the rule after replacing the project", async () => {
      db._rows.push(scriptRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script/project", project);
      expect(res.status).toBe(200);
      expect(saveAutomationProject).toHaveBeenCalled();
      expect(engine.unregister).toHaveBeenCalledWith("rule-script");
      expect(engine.register).toHaveBeenCalled();
    });

    it("leaves a disabled rule unregistered after replacing its project", async () => {
      db._rows.push(scriptRow({ enabled: 0 }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script/project", project);
      expect(res.status).toBe(200);
      expect(engine.unregister).toHaveBeenCalledWith("rule-script");
      expect(engine.register).not.toHaveBeenCalled();
    });
  });

  // ─── Execution history ─────────────────────────────────────────────────────

  describe("GET /history", () => {
    it("applies a limit to a single automation's entries", async () => {
      const res = await request(buildApp(), "GET", "/api/automations/history?ruleId=rule-a&limit=1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("ignores a negative limit rather than returning an empty slice", async () => {
      const res = await request(buildApp(), "GET", "/api/automations/history?ruleId=rule-a&limit=-3");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("passes the limit straight to the log for an admin, who needs no read filtering", async () => {
      user = { userId: "admin-1", role: "admin" };
      const res = await request(buildApp(), "GET", "/api/automations/history?limit=1");
      expect(res.status).toBe(200);
      expect(executionLog.list).toHaveBeenCalledWith(1);
    });
  });

  // ─── Command evidence bounds ───────────────────────────────────────────────

  describe("GET /:id/command-evidence", () => {
    it("403s a caller who may not read the automation", async () => {
      db._rows.push(formRow());
      const res = await request(
        buildApp({ resolver: denyingResolver }),
        "GET",
        "/api/automations/rule-form/command-evidence",
      );
      expect(res.status).toBe(403);
    });

    it("defaults to 100 commands when no limit is given", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "GET", "/api/automations/rule-form/command-evidence");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
      expect(commandHistoryStore.listForRule).toHaveBeenCalledWith("rule-form", 100);
    });

    it("falls back to 100 for a limit that is not a number", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "GET", "/api/automations/rule-form/command-evidence?limit=lots");
      expect(res.body.limit).toBe(100);
    });

    it("clamps an oversized limit to the 200 ceiling", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "GET", "/api/automations/rule-form/command-evidence?limit=5000");
      expect(res.body.limit).toBe(200);
    });

    it("raises a zero limit to one rather than querying for nothing", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "GET", "/api/automations/rule-form/command-evidence?limit=0");
      expect(res.body.limit).toBe(1);
    });

    it("reports no commands when durable history is not wired", async () => {
      db._rows.push(formRow());
      const res = await request(
        buildApp({ withCommandHistory: false }),
        "GET",
        "/api/automations/rule-form/command-evidence",
      );
      expect(res.status).toBe(200);
      expect(res.body.commands).toEqual([]);
    });
  });

  // ─── Named triggers and UI modules ─────────────────────────────────────────

  it("fires a named trigger with an empty payload when the request carries no body", async () => {
    // No Content-Type, so express.json leaves req.body undefined — the route
    // must not publish `undefined` as the trigger payload.
    const res = await request(buildApp(), "POST", "/api/automations/trigger/gate-open", undefined, {
      omitContentType: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, trigger: "gate-open" });
  });

  it("403s a UI module the caller may not read, without revealing whether one exists", async () => {
    db._rows.push(formRow({ compiled_ui: "module-source" }));
    const res = await request(
      buildApp({ resolver: denyingResolver }),
      "GET",
      "/api/automations/rule-form/ui-module",
    );
    expect(res.status).toBe(403);
  });

  // ─── List projection ───────────────────────────────────────────────────────

  describe("GET / projection", () => {
    it("reads a row written before rule_type and trigger_type existed as a form/mqtt rule", async () => {
      db._rows.push(formRow({ rule_type: null, trigger_type: null }));
      const res = await request(buildApp(), "GET", "/api/automations");
      expect(res.status).toBe(200);
      expect(res.body[0].ruleType).toBe("form");
      expect(res.body[0].triggerType).toBe("mqtt");
    });

    it("reports a script rule with no extracted metadata as structured null", async () => {
      db._rows.push(scriptRow({ structured_metadata: null }));
      const res = await request(buildApp(), "GET", "/api/automations");
      expect(res.body[0].ruleType).toBe("script");
      expect(res.body[0].structured).toBeNull();
    });

    it("parses stored structured metadata for a script rule", async () => {
      db._rows.push(scriptRow({ structured_metadata: JSON.stringify({ actions: ["publish"] }) }));
      const res = await request(buildApp(), "GET", "/api/automations");
      expect(res.body[0].structured).toEqual({ actions: ["publish"] });
    });
  });

  // ─── Trigger configuration ─────────────────────────────────────────────────

  describe("trigger configuration", () => {
    it("refuses a cron rule with no expression to run on", async () => {
      const res = await request(buildApp(), "POST", "/api/automations", {
        name: "Nightly",
        triggerType: "cron",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "cmnd/x",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("cronExpression is required");
    });

    it("keeps the stored cron expression when an update omits it", async () => {
      db._rows.push(formRow({ trigger_type: "cron", cron_expression: "0 9 * * *", trigger_topic: "" }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Renamed" });
      expect(res.status).toBe(200);
      const write = db.lastRun("UPDATE automation_rules SET name");
      expect(write?.args).toContain("0 9 * * *");
    });

    it("refuses a cron update whose stored expression is missing too", async () => {
      db._rows.push(formRow({ trigger_type: "cron", cron_expression: null, trigger_topic: "" }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Renamed" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("cronExpression is required");
    });

    it("stores a manual-only rule with no pattern at all", async () => {
      const res = await request(buildApp(), "POST", "/api/automations", {
        name: "Manual",
        triggerType: "none",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "cmnd/x",
      });
      expect(res.status).toBe(200);
      const write = db.lastRun("INSERT INTO automation_rules");
      expect(write?.args).toContain("none");
    });

    it("requires a Shared State pattern when the trigger type is shared-state", async () => {
      const res = await request(buildApp(), "POST", "/api/automations", {
        name: "Overview",
        triggerType: "shared-state",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "cmnd/x",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("triggerTopic is required");
    });

    it("rejects a Shared State pattern that could never match a bucket/key path", async () => {
      const res = await request(buildApp(), "POST", "/api/automations", {
        name: "Overview",
        triggerType: "shared-state",
        triggerTopic: "bunker-summary/power/extra",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "cmnd/x",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at most two segments");
    });

    it("accepts a wildcard Shared State pattern and stores it in the trigger column", async () => {
      const res = await request(buildApp(), "POST", "/api/automations", {
        name: "Overview",
        triggerType: "shared-state",
        triggerTopic: "bunker-summary/#",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "cmnd/x",
      });
      expect(res.status).toBe(200);
      const write = db.lastRun("INSERT INTO automation_rules");
      expect(write?.args).toContain("bunker-summary/#");
      expect(write?.args).toContain("shared-state");
    });

    it("keeps the stored trigger pattern when an update omits it", async () => {
      db._rows.push(formRow({ trigger_topic: "sensor/kept" }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Renamed" });
      expect(res.status).toBe(200);
      expect(db.lastRun("UPDATE automation_rules SET name")?.args).toContain("sensor/kept");
    });
  });

  // ─── Script rule updates ───────────────────────────────────────────────────

  describe("PUT /:id on a script rule", () => {
    it("refuses a single-blob UI source, which belongs to the Project", async () => {
      db._rows.push(scriptRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", {
        uiSource: "export default () => null;",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Automation Project");
    });

    it("keeps the stored runtime projection when the update carries no project", async () => {
      db._rows.push(scriptRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", { name: "Renamed" });
      expect(res.status).toBe(200);
      expect(compileAutomationProject).not.toHaveBeenCalled();
      expect(saveAutomationProject).not.toHaveBeenCalled();
      expect(db.lastRun("UPDATE automation_rules SET name")?.args).toContain("compiled:stored");
    });

    it("returns compiler diagnostics and writes nothing when the project fails to compile", async () => {
      db._rows.push(scriptRow());
      vi.mocked(compileAutomationProject).mockRejectedValueOnce(
        new AutomationProjectCompileError([{ message: "unexpected token" }]),
      );
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", {
        project: { files: [{ path: "logic/index.ts", content: "!!" }] },
      });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ message: "unexpected token" }]);
      expect(db.lastRun("UPDATE automation_rules SET name")).toBeUndefined();
    });

    it("refuses an update to a script rule that has no compiled runtime to keep", async () => {
      db._rows.push(scriptRow({ script_source: null, compiled_js: null }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", { name: "Renamed" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("no compiled Automation Project runtime projection");
    });

    it("keeps the stored name when the update omits one", async () => {
      db._rows.push(scriptRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", { triggerTopic: "sensor/new" });
      expect(res.status).toBe(200);
      expect(db.lastRun("UPDATE automation_rules SET name")?.args).toContain("Stored Name");
    });

    it("leaves a disabled script rule unregistered after an update", async () => {
      db._rows.push(scriptRow({ enabled: 0 }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-script", { name: "Renamed" });
      expect(res.status).toBe(200);
      expect(engine.register).not.toHaveBeenCalled();
    });
  });

  // ─── Form rule updates ─────────────────────────────────────────────────────

  describe("PUT /:id on a form rule", () => {
    it("keeps the stored name and action target when the update omits them", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { triggerTopic: "sensor/new" });
      expect(res.status).toBe(200);
      const args = db.lastRun("UPDATE automation_rules SET name")?.args;
      expect(args).toContain("Stored Name");
      expect(args).toContain("cmnd/stored");
    });

    it("preserves an omitted condition and clears one sent as null", async () => {
      db._rows.push(formRow());
      await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Keep" });
      expect(db.lastRun("UPDATE automation_rules SET name")?.args).toContain("value_above");

      const db2 = db;
      db2._runs.length = 0;
      await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Clear", conditionType: null });
      const args = db.lastRun("UPDATE automation_rules SET name")?.args;
      expect(args).not.toContain("value_above");
      expect(args).toContain(null);
    });

    it("clears the UI source when an empty string is sent", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { uiSource: "" });
      expect(res.status).toBe(200);
      const args = db.lastRun("UPDATE automation_rules SET name")?.args;
      expect(args).not.toContain("stored-ui");
      expect(transpileUi).not.toHaveBeenCalled();
    });

    it("keeps the stored UI source when the field is whitespace only", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { uiSource: "   " });
      expect(res.status).toBe(200);
      expect(db.lastRun("UPDATE automation_rules SET name")?.args).toContain("stored-ui");
      expect(transpileUi).not.toHaveBeenCalled();
    });

    it("returns TSX diagnostics when the submitted UI source does not compile", async () => {
      db._rows.push(formRow());
      vi.mocked(transpileUi).mockReturnValue({
        success: false,
        errors: [{ message: "unterminated JSX" }],
      } as any);
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", {
        uiSource: "export default () => <div>",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("TSX compilation failed");
      expect(res.body.details).toEqual([{ message: "unterminated JSX" }]);
    });

    it("leaves a disabled form rule unregistered after an update", async () => {
      db._rows.push(formRow({ enabled: 0 }));
      const res = await request(buildApp(), "PUT", "/api/automations/rule-form", { name: "Renamed" });
      expect(res.status).toBe(200);
      expect(engine.register).not.toHaveBeenCalled();
    });
  });

  // ─── Fire context modes ────────────────────────────────────────────────────

  describe("POST /:id/fire", () => {
    beforeEach(() => {
      engine.getRule = vi.fn(() => ({ id: "rule-form", name: "Stored Name", topic: "sensor/stored" }) as any);
    });

    it("uses a supplied context verbatim, attributing it to the rule's UI", async () => {
      const res = await request(buildApp(), "POST", "/api/automations/rule-form/fire", {
        context: { topic: "custom/topic", state: { value: 42 } },
      });
      expect(res.status).toBe(200);
      expect(engine.fire).toHaveBeenCalledWith(
        "rule-form",
        expect.objectContaining({ topic: "custom/topic", deviceId: "ui-rule-form", state: { value: 42 } }),
      );
    });

    it("defaults a supplied context with no state to an empty record", async () => {
      await request(buildApp(), "POST", "/api/automations/rule-form/fire", {
        context: { topic: "custom/topic" },
      });
      expect(engine.fire).toHaveBeenCalledWith("rule-form", expect.objectContaining({ state: {} }));
    });

    it("ignores a context that names no topic and falls back to a manual fire", async () => {
      await request(buildApp(), "POST", "/api/automations/rule-form/fire", { context: { state: { a: 1 } } });
      expect(engine.fire).toHaveBeenCalledWith(
        "rule-form",
        expect.objectContaining({ topic: "sensor/stored", deviceId: "manual-fire" }),
      );
    });

    it("surfaces the failure reason when the execution did not succeed", async () => {
      engine.fire = vi.fn().mockResolvedValue({
        executionId: "exec-2",
        success: false,
        failureReason: "sandbox timeout",
        commandResults: [],
      });
      const res = await request(buildApp(), "POST", "/api/automations/rule-form/fire", {});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.failureReason).toBe("sandbox timeout");
    });
  });

  // ─── Automation state without a store ──────────────────────────────────────

  describe("state endpoints without a state store", () => {
    it("reports empty state rather than failing", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp({ withStateStore: false }), "GET", "/api/automations/rule-form/state");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("refuses a write it cannot persist", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp({ withStateStore: false }), "PUT", "/api/automations/rule-form/state", {
        key: "mode",
        value: "auto",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("State store not available");
    });

    it("reports a delete as done when there is nothing to delete from", async () => {
      const res = await request(
        buildApp({ withStateStore: false }),
        "DELETE",
        "/api/automations/rule-form/state/mode",
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });

  // ─── Public-demo allowlist ─────────────────────────────────────────────────

  describe("PATCH /:id/demo-access", () => {
    it("404s for an automation that does not exist", async () => {
      const res = await request(buildApp(), "PATCH", "/api/automations/missing/demo-access", {
        fireEvents: ["start"],
      });
      expect(res.status).toBe(404);
    });

    it("stores the declared allowlist", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PATCH", "/api/automations/rule-form/demo-access", {
        writableStateKeys: ["mode"],
        fireEvents: ["start"],
      });
      expect(res.status).toBe(200);
      const write = db.lastRun("SET demo_access");
      expect(write?.args[0]).toBe(JSON.stringify({ writableStateKeys: ["mode"], fireEvents: ["start"] }));
    });

    it("clears the allowlist when neither field is declared", async () => {
      db._rows.push(formRow());
      const res = await request(buildApp(), "PATCH", "/api/automations/rule-form/demo-access", {});
      expect(res.status).toBe(200);
      expect(db.lastRun("SET demo_access")?.args[0]).toBeNull();
    });
  });

  // ─── Startup registration fallbacks ────────────────────────────────────────

  describe("loadUiRules", () => {
    it("registers a row written before trigger_type existed as an mqtt rule", () => {
      db._rows.push(formRow({ trigger_type: null, cron_expression: null }));
      loadUiRules(
        engine as unknown as AutomationEngine,
        db as unknown as Database.Database,
        {} as unknown as DeviceRegistry,
        {} as unknown as CommandService,
      );
      expect(engine.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rule-form", triggerType: "mqtt", cronExpression: undefined }),
      );
    });

    it("registers a manual-only row with an empty pattern it can never match", () => {
      db._rows.push(formRow({ trigger_topic: "", trigger_type: "none" }));
      loadUiRules(
        engine as unknown as AutomationEngine,
        db as unknown as Database.Database,
        {} as unknown as DeviceRegistry,
        {} as unknown as CommandService,
      );
      expect(engine.register).toHaveBeenCalledWith(expect.objectContaining({ topic: "", triggerType: "none" }));
    });
  });
});
