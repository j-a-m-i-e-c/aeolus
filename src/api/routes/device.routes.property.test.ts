// src/api/routes/device.routes.property.test.ts
// Feature: unified-command-boundary — Property 6

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import express from "express";
import request from "supertest";
import { createDeviceRoutes } from "./device.routes.js";
import { httpStatusForCommandResult } from "./command-status.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService } from "../../automations/command-service.js";
import type { CapabilityDescriptor } from "../../connectors/connector.interface.js";
import type { ActionResult, CommandLifecycleState } from "../../core/types.js";

// Mock logger — the route logs the outcome; we don't assert on it here.
vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Pass-through auth so the property test focuses on route/result behavior.
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

const LIFECYCLE_STATES: CommandLifecycleState[] = [
  "REQUESTED",
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
];

/**
 * A valid action type — must contain at least one non-whitespace character to
 * pass the `validateAction` middleware (which rejects empty/whitespace-only types).
 */
const actionTypeArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringOf(fc.char(), { maxLength: 10 }),
    fc.stringOf(
      fc.char().filter((c) => c.trim().length > 0),
      { minLength: 1, maxLength: 10 },
    ),
    fc.stringOf(fc.char(), { maxLength: 10 }),
  )
  .map(([a, b, c]) => `${a}${b}${c}`);

/**
 * A Command_Result as the CommandService would produce it: always a terminal
 * `lifecycleState`, and — when unsuccessful — a non-empty human-readable error.
 */
const commandResultArb: fc.Arbitrary<ActionResult> = fc
  .record({
    success: fc.boolean(),
    lifecycleState: fc.constantFrom(...LIFECYCLE_STATES),
    error: fc.string({ minLength: 1, maxLength: 60 }),
    data: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
  })
  .map((r) => {
    // Successful results omit the error; failures always carry a non-empty one.
    if (r.success) {
      const { error: _drop, ...rest } = r;
      return rest as ActionResult;
    }
    return r as ActionResult;
  });

function buildApp(result: ActionResult): { app: express.Express; execute: ReturnType<typeof vi.fn> } {
  const registry = {
    getById: vi.fn().mockReturnValue({ id: "dev-1", name: "d", type: "light" }),
    getAll: vi.fn().mockReturnValue([]),
  };
  const execute = vi.fn().mockResolvedValue(result);
  const commandService = { execute };
  const getActionCatalog = vi.fn().mockReturnValue([] as CapabilityDescriptor[]);

  const app = express();
  app.use(express.json());
  app.use(
    "/api/devices",
    createDeviceRoutes(
      registry as unknown as DeviceRegistry,
      commandService as unknown as CommandService,
      getActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
      // Passthrough resource guard + permissive resolver: this property focuses
      // on the Command_Result contract, not resource authorization.
      (() => (_req: any, _res: any, next: any) => next()) as unknown as never,
      {
        hasResourcePermission: () => true,
        filterByPermission: (_u: string, _k: string, ids: string[]) => ids,
        effectivePermission: () => "write",
      } as never,
    ),
  );
  app.use(errorHandler);
  return { app, execute };
}

// The REST route returns the Command_Result truthfully as the body, with an
// expressive HTTP status derived purely from that result.
describe("REST route returns the Command_Result truthfully with an expressive status", () => {
  it("responds with the mapped status and the unaltered Command_Result for any service outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        commandResultArb,
        actionTypeArb,
        async (result, actionType) => {
          const { app } = buildApp(result);

          const res = await request(app)
            .post("/api/devices/dev-1/action")
            .send({ type: actionType, params: {} })
            .set("Content-Type", "application/json");

          // Status is the pure mapping of the outcome — success is always 200,
          // failures get an expressive 4xx/5xx (never a masked 200).
          expect(res.status).toBe(httpStatusForCommandResult(result));
          if (result.success) expect(res.status).toBe(200);
          // success is returned unaltered.
          expect(res.body.success).toBe(result.success);
          // lifecycleState is one of the defined values and preserved.
          expect(LIFECYCLE_STATES).toContain(res.body.lifecycleState);
          expect(res.body.lifecycleState).toBe(result.lifecycleState);
          // Failures carry a non-empty human-readable reason, unaltered.
          if (!result.success) {
            expect(typeof res.body.error).toBe("string");
            expect(res.body.error.length).toBeGreaterThan(0);
            expect(res.body.error).toBe(result.error);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("submits the command to the CommandService normalized as device_action with a rest source", async () => {
    await fc.assert(
      fc.asyncProperty(
        commandResultArb,
        actionTypeArb,
        fc.dictionary(fc.string(), fc.string()),
        async (result, actionType, params) => {
          const { app, execute } = buildApp(result);

          await request(app)
            .post("/api/devices/dev-1/action")
            .send({ type: actionType, params })
            .set("Content-Type", "application/json");

          expect(execute).toHaveBeenCalledWith(
            { type: "device_action", target: "dev-1", params: { actionType, ...params } },
            { kind: "rest", label: undefined },
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
