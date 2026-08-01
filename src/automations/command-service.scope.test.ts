// Feature: scoped-automation-authoring — CommandService authorization-scope enforcement
import { describe, it, expect, vi } from "vitest";
import { fc } from "@fast-check/vitest";
import { CommandService, type CommandServiceDeps } from "./command-service.js";
import type { AutomationScopeResolver, AuthorizationScope } from "./automation-scope-resolver.js";

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Build a CommandService with a fixed scope and spy handlers for each action type. */
function buildService(scope: AuthorizationScope) {
  const scopeResolver: AutomationScopeResolver = { resolve: () => scope };
  const deps = {
    mqttService: { isConnected: () => true, publish: vi.fn() },
    connectorManager: { getAcknowledgementCapability: () => undefined },
    logger: silentLogger(),
    scopeResolver,
  } as unknown as CommandServiceDeps;
  const svc = new CommandService(deps);

  const handlers = {
    device_action: vi.fn(async () => ({ success: true, lifecycleState: "DISPATCHED" as const })),
    toggle: vi.fn(async () => ({ success: true, lifecycleState: "DISPATCHED" as const })),
    publish: vi.fn(async () => undefined),
    webhook: vi.fn(async () => undefined),
  };
  svc.registerHandler("device_action", handlers.device_action);
  svc.registerHandler("toggle", handlers.toggle);
  svc.registerHandler("publish", handlers.publish);
  svc.registerHandler("webhook", handlers.webhook);
  return { svc, handlers };
}

const scoped = (deviceIds: string[]): AuthorizationScope => ({
  kind: "scoped",
  tabId: "t1",
  deviceIds: new Set(deviceIds),
  collections: new Set(),
});

describe("CommandService authorization-scope enforcement", () => {
  it("refuses an out-of-scope device action without dispatching", async () => {
    const { svc, handlers } = buildService(scoped(["d1"]));
    const result = await svc.execute(
      { type: "device_action", target: "d2", params: { actionType: "on" } },
      "rule1",
    );
    expect(result.success).toBe(false);
    expect(result.lifecycleState).toBe("FAILED");
    expect(result.failureKind).toBe("unauthorized");
    expect(handlers.device_action).not.toHaveBeenCalled();
  });

  it("allows an in-scope device action", async () => {
    const { svc, handlers } = buildService(scoped(["d1"]));
    const result = await svc.execute(
      { type: "device_action", target: "d1", params: { actionType: "on" } },
      "rule1",
    );
    expect(result.success).toBe(true);
    expect(handlers.device_action).toHaveBeenCalledOnce();
  });

  it("refuses a raw MQTT publish for a scoped automation", async () => {
    const { svc, handlers } = buildService(scoped(["d1"]));
    const result = await svc.execute(
      { type: "publish", target: "some/topic", params: { payload: "x" } },
      "rule1",
    );
    expect(result.failureKind).toBe("unauthorized");
    expect(handlers.publish).not.toHaveBeenCalled();
  });

  it("refuses a webhook for a scoped automation", async () => {
    const { svc, handlers } = buildService(scoped(["d1"]));
    const result = await svc.execute(
      { type: "webhook", target: "https://example.com", params: {} },
      "rule1",
    );
    expect(result.failureKind).toBe("unauthorized");
    expect(handlers.webhook).not.toHaveBeenCalled();
  });

  it("applies no restriction to an unrestricted automation", async () => {
    const { svc, handlers } = buildService({ kind: "unrestricted" });
    await svc.execute({ type: "device_action", target: "anything", params: { actionType: "on" } }, "r");
    await svc.execute({ type: "publish", target: "any/topic", params: { payload: "x" } }, "r");
    expect(handlers.device_action).toHaveBeenCalledOnce();
    expect(handlers.publish).toHaveBeenCalledOnce();
  });

  // Feature: scoped-automation-authoring, Property 3: Dispatch refuses out-of-scope devices and all scoped publishes
  it("scoped: refuses out-of-scope devices, all publishes and webhooks; dispatches in-scope devices", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 3 }),
        async (allowed, target) => {
          const { svc, handlers } = buildService(scoped(allowed));

          const dev = await svc.execute(
            { type: "device_action", target, params: { actionType: "on" } },
            "r",
          );
          if (allowed.includes(target)) {
            expect(dev.success).toBe(true);
          } else {
            expect(dev.failureKind).toBe("unauthorized");
          }

          const pub = await svc.execute({ type: "publish", target: "t", params: { payload: "x" } }, "r");
          expect(pub.failureKind).toBe("unauthorized");
          expect(handlers.publish).not.toHaveBeenCalled();

          const hook = await svc.execute({ type: "webhook", target: "https://x", params: {} }, "r");
          expect(hook.failureKind).toBe("unauthorized");
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: scoped-automation-authoring, Property 4: Unrestricted dispatch is unaffected
  it("unrestricted: never refuses on scope grounds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("device_action", "toggle", "publish", "webhook"),
        fc.string({ minLength: 1, maxLength: 5 }),
        async (type, target) => {
          const { svc } = buildService({ kind: "unrestricted" });
          const result = await svc.execute(
            { type, target, params: { actionType: "on", payload: "x" } },
            "r",
          );
          // Never an authorization refusal; publish/webhook succeed, device
          // actions dispatch through the spy handler.
          expect(result.failureKind).not.toBe("unauthorized");
        },
      ),
      { numRuns: 100 },
    );
  });
});
