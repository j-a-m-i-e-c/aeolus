// src/automations/command-history-integration.test.ts
// phase-1-runtime-foundations Task 4 — CommandService + PendingCommandTracker +
// CommandHistoryStore composed exactly as in the application root, proving the
// durable timeline (incl. intermediate ACKNOWLEDGED, Req 3.5) and restart
// reconciliation with zero physical dispatch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { CommandService, type CommandServiceDeps, restSource } from "./command-service.js";
import { CommandHistoryStore } from "./command-history-store.js";
import { PendingCommandTracker } from "./pending-command-tracker.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;
let executeActionMock: ReturnType<typeof vi.fn>;

/** Compose the tracker + store adapter exactly like src/index.ts. */
function buildTracker(): PendingCommandTracker {
  return new PendingCommandTracker({
    onTransition: (ev) => {
      if (!ev.commandId) return;
      if (store.currentState(ev.commandId) === "REQUESTED") {
        store.transition({ commandId: ev.commandId, toState: "DISPATCHED", timestamp: ev.timestamp, terminal: false });
      }
      store.transition({ commandId: ev.commandId, toState: ev.toState, timestamp: ev.timestamp, terminal: false });
    },
  });
}

function buildService(tracker: PendingCommandTracker): CommandService {
  const deps = {
    mqttService: { isConnected: () => true, publish: vi.fn() },
    connectorManager: {
      executeAction: executeActionMock,
      getAcknowledgementCapability: () => ({ supported: true, responseTopic: "aeolus/acks/dev-1" }),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    deviceRegistry: { getById: () => ({ id: "dev-1" }) },
    pendingCommandTracker: tracker,
    commandHistoryStore: store,
  } as unknown as CommandServiceDeps;
  const svc = new CommandService(deps);
  svc.registerHandler("device_action", async (_a, _r, d) => d.connectorManager.executeAction("dev-1", { type: "on", deviceId: "dev-1", params: {} }));
  return svc;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
  executeActionMock = vi.fn().mockResolvedValue({ success: true });
});

afterEach(() => db.close());

describe("durable timeline — observed tier with ACK before observation (Req 3.5)", () => {
  it("persists REQUESTED -> DISPATCHED -> ACKNOWLEDGED -> OBSERVED", async () => {
    const tracker = buildTracker();
    const svc = buildService(tracker);

    const promise = svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      restSource(),
      { condition: (s) => s.on === true, timeoutMs: 10_000 },
    );

    // The REQUESTED record (with correlationId) exists synchronously before the
    // dispatch handler's await resolves — route an ACK, then an observation.
    const correlationId = store.list()[0]?.correlationId;
    expect(correlationId).toBeDefined();
    tracker.route({ correlationId: correlationId!, success: true });
    tracker.observeState("dev-1", { on: true });

    const result = await promise;
    expect(result.lifecycleState).toBe("OBSERVED");
    expect(result.commandId).toBeDefined();

    const rec = store.get(result.commandId!);
    expect(rec?.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "OBSERVED",
    ]);
    expect(rec?.lifecycleState).toBe("OBSERVED");
    expect(rec?.terminalAt).toBeGreaterThan(0);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });
});

describe("restart reconciliation performs zero physical dispatch", () => {
  it("marks an in-flight command interrupted without re-dispatching", async () => {
    const tracker = buildTracker();
    const svc = buildService(tracker);

    // Start an observed command whose predicate never satisfies; let it reach a
    // durable DISPATCHED (non-terminal) then simulate a restart mid-flight.
    const promise = svc.execute(
      { type: "device_action", target: "dev-1", params: {} },
      restSource(),
      { condition: () => false, timeoutMs: 50 },
    );
    await new Promise((r) => setTimeout(r, 5)); // let dispatch settle -> DISPATCHED recorded

    const dispatchesBefore = executeActionMock.mock.calls.length;
    expect(dispatchesBefore).toBe(1);

    const reconciled = store.reconcileInterrupted(Date.now());
    expect(reconciled).toBe(1);
    // Reconciliation never re-dispatches a physical command.
    expect(executeActionMock).toHaveBeenCalledTimes(dispatchesBefore);

    const recs = store.list();
    expect(recs[0].lifecycleState).toBe("FAILED");
    expect(recs[0].failureKind).toBe("interrupted");
    expect(recs[0].terminalAt).toBeGreaterThan(0);

    // Drain the still-pending command (times out in the "old" process); its
    // late terminal transition is a no-op against the reconciled record.
    const result = await promise;
    expect(result.lifecycleState).toBe("TIMED_OUT");
    expect(store.get(recs[0].commandId)?.failureKind).toBe("interrupted");
  });
});
