// src/api/routes/automation.routes.test.ts — Unit tests for automation REST API routes

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createAutomationRoutes, loadUiRules } from "./automation.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { AutomationEngine } from "../../automations/automation-engine.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { ActionExecutor } from "../../automations/action-executor.js";
import type { ExecutionLog } from "../../automations/execution-log.js";
import type { AutomationStateStore } from "../../automations/automation-state-store.js";
import type { ConditionRegistry } from "../../automations/condition-registry.js";
import type Database from "better-sqlite3";

// Mock logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock auth middleware to pass through — these tests focus on route logic, not auth
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock transpiler to avoid real TypeScript compilation
vi.mock("../../automations/transpiler.js", () => ({
  transpile: vi.fn((source: string) => ({ success: true, js: `compiled:${source}` })),
  transpileUi: vi.fn((source: string) => ({ success: true, js: `ui-compiled:${source}` })),
}));

// Mock structured metadata extractor
vi.mock("../../automations/structured-metadata-extractor.js", () => ({
  extractStructuredMetadata: vi.fn(() => ({ actions: [], triggers: [] })),
}));

// Mock snippet catalog
vi.mock("../../automations/snippet-catalog.js", () => ({
  buildSnippetCatalog: vi.fn(() => [{ id: "snippet-1", label: "Test Snippet" }]),
}));

// Mock cron-utils
vi.mock("../../automations/cron-utils.js", () => ({
  isValidCron: vi.fn((expr: string) => expr === "* * * * *" || expr === "0 9 * * *"),
}));

// Mock event bus
vi.mock("../../core/event-bus.js", () => ({
  eventBus: { emit: vi.fn() },
  AUTOMATION_STATE_CHANGE: "automation:state-change",
}));

/** Minimal HTTP helper — sends a request to an Express app and returns status + body */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
        .then(async (res) => {
          const contentType = res.headers.get("content-type") || "";
          let responseBody: unknown;
          if (contentType.includes("application/json")) {
            responseBody = await res.json();
          } else {
            responseBody = await res.text();
          }
          server.close();
          resolve({ status: res.status, body: responseBody, contentType });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockDb() {
  const rows: Record<string, any>[] = [];

  const mockStatement = {
    all: vi.fn(() => rows),
    get: vi.fn((id?: string) => rows.find((r) => r.id === id) ?? undefined),
    run: vi.fn((...args: any[]) => {
      // For INSERT, add a row to our mock store
      return { changes: 1 };
    }),
  };

  return {
    prepare: vi.fn(() => mockStatement),
    _rows: rows,
    _statement: mockStatement,
  };
}

function createMockEngine() {
  return {
    listRules: vi.fn(() => []),
    register: vi.fn(),
    unregister: vi.fn(),
    getRule: vi.fn(() => null),
  };
}

function createMockRegistry() {
  return {
    getDevice: vi.fn(),
    listDevices: vi.fn(() => []),
  };
}

function createMockActionExecutor() {
  return {
    execute: vi.fn(),
  };
}

function createMockExecutionLog() {
  return {
    list: vi.fn(() => [
      { id: "log-1", ruleId: "rule-1", timestamp: 1000, status: "success" },
      { id: "log-2", ruleId: "rule-2", timestamp: 2000, status: "error" },
    ]),
    getByRuleId: vi.fn((ruleId: string) => [
      { id: "log-1", ruleId, timestamp: 1000, status: "success" },
    ]),
  };
}

function createMockStateStore() {
  const store: Record<string, Record<string, unknown>> = {};
  return {
    getAll: vi.fn((ruleId: string) => store[ruleId] || {}),
    set: vi.fn((ruleId: string, key: string, value: unknown) => {
      if (!store[ruleId]) store[ruleId] = {};
      store[ruleId][key] = value;
    }),
    delete: vi.fn((ruleId: string, key: string) => {
      if (store[ruleId]) delete store[ruleId][key];
    }),
    deleteAll: vi.fn((ruleId: string) => {
      delete store[ruleId];
    }),
    loadFromDb: vi.fn(),
  };
}

function createMockConditionRegistry() {
  return {
    buildCondition: vi.fn(() => undefined),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("automation.routes", () => {
  let app: express.Express;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEngine: ReturnType<typeof createMockEngine>;
  let mockDeviceRegistry: ReturnType<typeof createMockRegistry>;
  let mockActionExecutor: ReturnType<typeof createMockActionExecutor>;
  let mockExecutionLog: ReturnType<typeof createMockExecutionLog>;
  let mockStateStore: ReturnType<typeof createMockStateStore>;
  let mockConditionRegistry: ReturnType<typeof createMockConditionRegistry>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEngine = createMockEngine();
    mockDeviceRegistry = createMockRegistry();
    mockActionExecutor = createMockActionExecutor();
    mockExecutionLog = createMockExecutionLog();
    mockStateStore = createMockStateStore();
    mockConditionRegistry = createMockConditionRegistry();

    app = express();
    app.use(express.json());
    app.use(
      "/api/automations",
      createAutomationRoutes(
        mockEngine as unknown as AutomationEngine,
        mockDb as unknown as DatabaseType,
        mockDeviceRegistry as unknown as DeviceRegistry,
        mockActionExecutor as unknown as ActionExecutor,
        mockExecutionLog as unknown as ExecutionLog,
        "", // sandboxTypesPath
        undefined, // connectorRegistry
        mockStateStore as unknown as AutomationStateStore,
        mockConditionRegistry as unknown as ConditionRegistry,
      ),
    );
    app.use(errorHandler);
  });

  // ─── GET /api/automations/snippets ───────────────────────────────────────

  describe("GET /api/automations/snippets", () => {
    it("should return empty array when no connector registry provided", async () => {
      // Re-create app without connectorRegistry (already undefined above)
      const res = await request(app, "GET", "/api/automations/snippets");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── GET /api/automations/types ──────────────────────────────────────────

  describe("GET /api/automations/types", () => {
    it("should return 500 when sandbox types file does not exist", async () => {
      const res = await request(app, "GET", "/api/automations/types");
      expect(res.status).toBe(500);
      expect((res.body as any).error).toBe("Type definitions not available");
    });
  });

  // ─── GET /api/automations/history ────────────────────────────────────────

  describe("GET /api/automations/history", () => {
    it("should return all execution log entries", async () => {
      const res = await request(app, "GET", "/api/automations/history");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("log-1");
      expect(body[1].id).toBe("log-2");
    });

    it("should filter by ruleId when provided", async () => {
      const res = await request(app, "GET", "/api/automations/history?ruleId=rule-1");
      expect(res.status).toBe(200);
      expect(mockExecutionLog.getByRuleId).toHaveBeenCalledWith("rule-1");
    });

    it("should limit results when limit query param is provided", async () => {
      const res = await request(app, "GET", "/api/automations/history?limit=1");
      expect(res.status).toBe(200);
      expect(mockExecutionLog.list).toHaveBeenCalledWith(1);
    });
  });

  // ─── GET /api/automations ────────────────────────────────────────────────

  describe("GET /api/automations", () => {
    it("should return empty array when no rules exist", async () => {
      const res = await request(app, "GET", "/api/automations");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return file-based rules from engine", async () => {
      mockEngine.listRules.mockReturnValue([
        { id: "file-rule-1", topic: "sensors/temp", name: "Temp Rule", condition: null },
      ]);

      const res = await request(app, "GET", "/api/automations");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("file-rule-1");
      expect(body[0].source).toBe("file");
      expect(body[0].ruleType).toBe("file");
      expect(body[0].enabled).toBe(true);
    });

    it("should return DB-based form rules", async () => {
      const dbRow = {
        id: "db-rule-1",
        name: "DB Rule",
        trigger_topic: "devices/light",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: '{"state":"on"}',
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      };
      mockDb._rows.push(dbRow);

      const res = await request(app, "GET", "/api/automations");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("db-rule-1");
      expect(body[0].source).toBe("ui");
      expect(body[0].ruleType).toBe("form");
      expect(body[0].actionType).toBe("publish");
      expect(body[0].actionParams).toEqual({ state: "on" });
    });
  });

  // ─── POST /api/automations ───────────────────────────────────────────────

  describe("POST /api/automations", () => {
    it("should create a form rule and return success with id", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "New Rule",
        triggerTopic: "sensors/temp",
        ruleType: "form",
        actionType: "publish",
        actionTarget: "devices/light/set",
        actionParams: { state: "on" },
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe("string");
    });

    it("should create a script rule and return success with id", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "Script Rule",
        triggerTopic: "sensors/temp",
        ruleType: "script",
        scriptSource: "export default function run() {}",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.id).toBeDefined();
    });

    it("should return 400 when name is missing", async () => {
      const res = await request(app, "POST", "/api/automations", {
        triggerTopic: "sensors/temp",
        actionType: "publish",
        actionTarget: "devices/light/set",
      });
      expect(res.status).toBe(400);
    });

    it("should create a cron-triggered rule", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "Cron Rule",
        ruleType: "form",
        triggerType: "cron",
        cronExpression: "* * * * *",
        actionType: "publish",
        actionTarget: "devices/light/set",
        actionParams: {},
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
    });

    it("should return 400 for invalid cron expression", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "Bad Cron",
        ruleType: "form",
        triggerType: "cron",
        cronExpression: "invalid-cron",
        actionType: "publish",
        actionTarget: "devices/light/set",
      });
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("Invalid cron");
    });

    it("should return 400 when scriptSource is missing for script rules", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "Script Rule",
        ruleType: "script",
      });
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("scriptSource");
    });

    it("should return 400 when actionType/actionTarget missing for form rules", async () => {
      const res = await request(app, "POST", "/api/automations", {
        name: "Form Rule",
        ruleType: "form",
        triggerTopic: "sensors/temp",
      });
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("actionType");
    });
  });

  // ─── PUT /api/automations/:id ────────────────────────────────────────────

  describe("PUT /api/automations/:id", () => {
    it("should return 404 when rule does not exist", async () => {
      const res = await request(app, "PUT", "/api/automations/nonexistent", {
        name: "Updated",
      });
      expect(res.status).toBe(404);
    });

    it("should update a form rule and return success", async () => {
      const existingRule = {
        id: "rule-1",
        name: "Old Name",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: '{"state":"on"}',
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      };
      mockDb._rows.push(existingRule);

      const res = await request(app, "PUT", "/api/automations/rule-1", {
        name: "Updated Name",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.id).toBe("rule-1");
    });

    it("should update a script rule and return success", async () => {
      const existingRule = {
        id: "script-1",
        name: "Script Rule",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "script",
        action_target: "",
        action_params: "{}",
        rule_type: "script",
        script_source: "export default function run() {}",
        compiled_js: "compiled:export default function run() {}",
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      };
      mockDb._rows.push(existingRule);

      const res = await request(app, "PUT", "/api/automations/script-1", {
        name: "Updated Script",
        scriptSource: "export default function updated() {}",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.id).toBe("script-1");
    });
  });

  // ─── DELETE /api/automations/:id ─────────────────────────────────────────

  describe("DELETE /api/automations/:id", () => {
    it("should return 404 when rule does not exist", async () => {
      const res = await request(app, "DELETE", "/api/automations/nonexistent");
      expect(res.status).toBe(404);
    });

    it("should delete an existing rule and return success", async () => {
      mockDb._rows.push({
        id: "rule-to-delete",
        name: "Delete Me",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: "{}",
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      });

      const res = await request(app, "DELETE", "/api/automations/rule-to-delete");
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockEngine.unregister).toHaveBeenCalledWith("rule-to-delete");
      expect(mockStateStore.deleteAll).toHaveBeenCalledWith("rule-to-delete");
    });
  });

  // ─── PATCH /api/automations/:id/toggle ───────────────────────────────────

  describe("PATCH /api/automations/:id/toggle", () => {
    it("should return 404 when rule does not exist", async () => {
      const res = await request(app, "PATCH", "/api/automations/nonexistent/toggle", {
        enabled: true,
      });
      expect(res.status).toBe(404);
    });

    it("should disable a rule and return success", async () => {
      mockDb._rows.push({
        id: "toggle-rule",
        name: "Toggle Me",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: "{}",
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      });

      const res = await request(app, "PATCH", "/api/automations/toggle-rule/toggle", {
        enabled: false,
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.enabled).toBe(false);
      expect(mockEngine.unregister).toHaveBeenCalledWith("toggle-rule");
    });

    it("should enable a rule and return success", async () => {
      mockDb._rows.push({
        id: "toggle-rule-2",
        name: "Toggle Me 2",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: "{}",
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 0,
        created_at: 1000,
      });

      const res = await request(app, "PATCH", "/api/automations/toggle-rule-2/toggle", {
        enabled: true,
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.enabled).toBe(true);
    });

    it("should return 400 when enabled field is missing", async () => {
      const res = await request(app, "PATCH", "/api/automations/some-rule/toggle", {});
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/automations/:id/fire ──────────────────────────────────────

  describe("POST /api/automations/:id/fire", () => {
    it("should return 404 when rule is not found or not enabled", async () => {
      const res = await request(app, "POST", "/api/automations/nonexistent/fire", {});
      expect(res.status).toBe(404);
    });

    it("should fire a rule and return success", async () => {
      const mockAction = vi.fn().mockResolvedValue(undefined);
      mockEngine.getRule.mockReturnValue({
        id: "fire-rule",
        topic: "sensors/temp",
        name: "Fire Me",
        action: mockAction,
      });

      const res = await request(app, "POST", "/api/automations/fire-rule/fire", {
        value: 42,
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.ruleId).toBe("fire-rule");
      expect(mockAction).toHaveBeenCalled();
    });
  });

  // ─── GET /api/automations/:id/state ──────────────────────────────────────

  describe("GET /api/automations/:id/state", () => {
    it("should return empty object when no state exists", async () => {
      const res = await request(app, "GET", "/api/automations/rule-1/state");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("should return state key-value pairs for a rule", async () => {
      mockStateStore.getAll.mockReturnValue({ counter: 5, lastRun: "2024-01-01" });

      const res = await request(app, "GET", "/api/automations/rule-1/state");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ counter: 5, lastRun: "2024-01-01" });
    });
  });

  // ─── PUT /api/automations/:id/state ──────────────────────────────────────

  describe("PUT /api/automations/:id/state", () => {
    it("should set a state key-value pair and return success", async () => {
      const res = await request(app, "PUT", "/api/automations/rule-1/state", {
        key: "counter",
        value: 10,
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockStateStore.set).toHaveBeenCalledWith("rule-1", "counter", 10);
    });

    it("should return 400 when key is missing", async () => {
      const res = await request(app, "PUT", "/api/automations/rule-1/state", {
        value: 10,
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /api/automations/:id/state/:key ──────────────────────────────

  describe("DELETE /api/automations/:id/state/:key", () => {
    it("should delete a state key and return success", async () => {
      const res = await request(app, "DELETE", "/api/automations/rule-1/state/counter");
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockStateStore.delete).toHaveBeenCalledWith("rule-1", "counter");
    });
  });

  // ─── GET /api/automations/:id/ui-module ──────────────────────────────────

  describe("GET /api/automations/:id/ui-module", () => {
    it("should return 404 when rule does not exist", async () => {
      const res = await request(app, "GET", "/api/automations/nonexistent/ui-module");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toBe("Automation rule not found");
    });

    it("should return 404 when rule has no compiled UI", async () => {
      mockDb._rows.push({
        id: "no-ui-rule",
        name: "No UI",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: "{}",
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      });

      const res = await request(app, "GET", "/api/automations/no-ui-rule/ui-module");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toBe("No compiled UI module");
    });

    it("should return compiled UI as JavaScript when available", async () => {
      mockDb._rows.push({
        id: "ui-rule",
        name: "UI Rule",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: "{}",
        rule_type: "script",
        script_source: "export default function() {}",
        compiled_js: "compiled",
        structured_metadata: null,
        ui_source: "const App = () => <div/>",
        compiled_ui: "const App = () => React.createElement('div')",
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      });

      const res = await request(app, "GET", "/api/automations/ui-rule/ui-module");
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("javascript");
      expect(res.body).toBe("const App = () => React.createElement('div')");
    });
  });
});

type DatabaseType = Database.Database;

// ─── loadUiRules tests ─────────────────────────────────────────────────────

describe("loadUiRules", () => {
  it("loads enabled rules from database and registers them in engine", () => {
    const mockEngine = createMockEngine();
    const mockDeviceRegistry = createMockRegistry();
    const mockActionExecutor = createMockActionExecutor();
    const mockConditionRegistry = createMockConditionRegistry();

    const rows = [
      {
        id: "rule-1",
        name: "Form Rule",
        trigger_topic: "sensors/temp",
        condition_type: null,
        condition_value: null,
        action_type: "publish",
        action_target: "devices/light/set",
        action_params: '{"state":"on"}',
        rule_type: "form",
        script_source: null,
        compiled_js: null,
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 1000,
      },
      {
        id: "rule-2",
        name: "Script Rule",
        trigger_topic: "home/#",
        condition_type: null,
        condition_value: null,
        action_type: "script",
        action_target: "",
        action_params: "{}",
        rule_type: "script",
        script_source: "log.info('hi')",
        compiled_js: "compiled_code",
        structured_metadata: null,
        ui_source: null,
        compiled_ui: null,
        trigger_type: "mqtt",
        cron_expression: null,
        enabled: 1,
        created_at: 2000,
      },
    ];

    const mockDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(() => rows),
      })),
    };

    loadUiRules(
      mockEngine as unknown as AutomationEngine,
      mockDb as unknown as DatabaseType,
      mockDeviceRegistry as unknown as DeviceRegistry,
      mockActionExecutor as unknown as ActionExecutor,
      mockConditionRegistry as unknown as ConditionRegistry,
    );

    expect(mockEngine.register).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no enabled rules exist", () => {
    const mockEngine = createMockEngine();
    const mockDeviceRegistry = createMockRegistry();
    const mockActionExecutor = createMockActionExecutor();

    const mockDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
      })),
    };

    loadUiRules(
      mockEngine as unknown as AutomationEngine,
      mockDb as unknown as DatabaseType,
      mockDeviceRegistry as unknown as DeviceRegistry,
      mockActionExecutor as unknown as ActionExecutor,
    );

    expect(mockEngine.register).not.toHaveBeenCalled();
  });
});
