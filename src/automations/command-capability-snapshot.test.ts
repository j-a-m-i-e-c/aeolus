// Guards the capability snapshot and author intent recorded on a command.
//
// The point of the snapshot is that an unreached evidence stage stays EXPLAINABLE
// forever. "ACKNOWLEDGED was not reached" can mean three unrelated things — the
// device cannot acknowledge, this command did not require it, or it was required and
// never arrived — and only recorded context tells them apart. These tests hold two
// lines: the context is captured at acceptance from the profile then in force, and
// author-supplied text can never reach the parts of the record that decide proof.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { CommandService, type CommandServiceDeps, automationSource } from "./command-service.js";
import { CommandHistoryStore } from "./command-history-store.js";
import { PendingCommandTracker } from "./pending-command-tracker.js";
import {
  MAX_EVIDENCE_LABEL_LENGTH,
  sanitiseCommandIntent,
  sanitiseEvidenceLabel,
} from "./command-lifecycle.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Pure label handling ──────────────────────────────────────────────────────

describe("sanitiseEvidenceLabel", () => {
  it("keeps an ordinary caption unchanged", () => {
    expect(sanitiseEvidenceLabel("Transfer 500 L")).toBe("Transfer 500 L");
  });

  it("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(sanitiseEvidenceLabel(value)).toBeUndefined();
    }
  });

  it("treats a blank or whitespace-only label as absent", () => {
    expect(sanitiseEvidenceLabel("")).toBeUndefined();
    expect(sanitiseEvidenceLabel("   \t  ")).toBeUndefined();
  });

  it("collapses newlines so a template literal cannot break the receipt layout", () => {
    expect(sanitiseEvidenceLabel("Transfer\n\n  500 L")).toBe("Transfer 500 L");
  });

  it("strips control characters at the boundary rather than trusting consumers", () => {
    // The value reaches a durable record, an admin API and a sandboxed UI. Fixing it
    // once here is cheaper to reason about than three correct escapes downstream.
    expect(sanitiseEvidenceLabel("Stop\u0000 pump\u0007")).toBe("Stop pump");
  });

  it("caps an over-long label instead of storing an essay", () => {
    const label = sanitiseEvidenceLabel("x".repeat(MAX_EVIDENCE_LABEL_LENGTH + 50));
    expect(label).toHaveLength(MAX_EVIDENCE_LABEL_LENGTH);
  });
});

describe("sanitiseCommandIntent", () => {
  it("returns undefined when there is no usable text at all", () => {
    expect(sanitiseCommandIntent(undefined)).toBeUndefined();
    expect(sanitiseCommandIntent({})).toBeUndefined();
    expect(sanitiseCommandIntent({ intent: "  ", observedLabel: "" })).toBeUndefined();
  });

  it("keeps whichever label was supplied", () => {
    expect(sanitiseCommandIntent({ intent: "Seal bunker" })).toEqual({ intent: "Seal bunker" });
    expect(sanitiseCommandIntent({ observedLabel: "Flow detected" })).toEqual({
      observedLabel: "Flow detected",
    });
  });
});

// ── Service-level: what actually lands on the record ─────────────────────────

let db: DatabaseType;
let store: CommandHistoryStore;

const PUMP = { id: "pump-1", name: "Transfer Pump", integration: "mqtt" };
const FLOW = { id: "flow-1", name: "Transfer Flow Meter", integration: "mqtt" };

function registry(devices: Array<{ id: string; name: string; integration: string }>) {
  return {
    getById: (id: string) => devices.find((device) => device.id === id),
  } as unknown as NonNullable<CommandServiceDeps["deviceRegistry"]>;
}

function deps(overrides?: Partial<CommandServiceDeps>): CommandServiceDeps {
  return {
    mqttService: {
      isConnected: vi.fn().mockReturnValue(true),
      publish: vi.fn(),
    } as unknown as CommandServiceDeps["mqttService"],
    connectorManager: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getAcknowledgementCapability: vi.fn().mockReturnValue(undefined),
    } as unknown as CommandServiceDeps["connectorManager"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as CommandServiceDeps["logger"],
    commandHistoryStore: store,
    deviceRegistry: registry([PUMP, FLOW]),
    ...overrides,
  };
}

function service(overrides?: Partial<CommandServiceDeps>): CommandService {
  const svc = new CommandService(deps(overrides));
  svc.registerHandler("device_action", async () => ({ success: true }), { physical: true });
  return svc;
}

/** A confirmation contract observing the flow meter, as the sandbox would build it. */
function flowConfirm() {
  return {
    deviceId: FLOW.id,
    condition: (state: Record<string, unknown>) => Number(state.litresPerMinute) > 0,
    conditionSpec: { field: "litresPerMinute", op: "gt", value: 0 },
  };
}

function descriptor() {
  return { type: "device_action", target: PUMP.id, params: { actionType: "command", on: true } };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
});

afterEach(() => db.close());

describe("CommandService — capability snapshot", () => {
  it("records a dispatch-only command as having no ack capability and no observation", () => {
    // The honest reading of this record later: ACKNOWLEDGED was unreachable because
    // the device declares no ack capability, and OBSERVED because this command
    // carried no observation contract. Neither is a failure.
    return service()
      .execute(descriptor(), automationSource("rule-1"))
      .then((result) => {
        const record = store.get(result.commandId!);
        expect(record?.capabilityCeiling).toBe("dispatch");
        expect(record?.ackAvailable).toBe(false);
        expect(record?.observationConfigured).toBe(false);
        expect(record?.observedDeviceId).toBeUndefined();
        expect(record?.conditionSpec).toBeUndefined();
      });
  });

  it("records the ack capability when the device declares one", async () => {
    const svc = service({
      connectorManager: {
        executeAction: vi.fn().mockResolvedValue({ success: true }),
        getAcknowledgementCapability: vi.fn().mockReturnValue({ supported: true }),
      } as unknown as CommandServiceDeps["connectorManager"],
      pendingCommandTracker: new PendingCommandTracker(),
    });

    const result = await svc.execute(descriptor(), automationSource("rule-1"), undefined, "dispatch");

    const record = store.get(result.commandId!);
    expect(record?.ackAvailable).toBe(true);
    // The ceiling is what the device COULD prove; the effective tier is what this
    // command asked to be held to. Recording both is what makes a deliberate
    // lower-tier command distinguishable from a clamp.
    expect(record?.capabilityCeiling).toBe("acknowledged");
    expect(record?.effectiveTier).toBe("dispatch");
    expect(record?.requestedTier).toBe("dispatch");
  });

  it("records the observation contract, the observing device and both names", async () => {
    const tracker = new PendingCommandTracker();
    const svc = service({ pendingCommandTracker: tracker });

    const pending = svc.execute(descriptor(), automationSource("rule-1"), flowConfirm(), "observed");
    tracker.observeState(FLOW.id, { litresPerMinute: 120 });
    const result = await pending;

    const record = store.get(result.commandId!);
    expect(record?.capabilityCeiling).toBe("observed");
    expect(record?.observationConfigured).toBe(true);
    expect(record?.observedDeviceId).toBe(FLOW.id);
    expect(record?.conditionSpec).toEqual({ field: "litresPerMinute", op: "gt", value: 0 });
    expect(record?.targetDeviceName).toBe("Transfer Pump");
    expect(record?.observedDeviceName).toBe("Transfer Flow Meter");
  });

  it("names the transport the command was handed to, not the observer's", async () => {
    const tracker = new PendingCommandTracker();
    const svc = service({
      pendingCommandTracker: tracker,
      // The pump is reached over a connector; the flow meter happens to be MQTT.
      // DISPATCHED is a statement about the pump's transport only.
      deviceRegistry: registry([{ ...PUMP, integration: "hue" }, FLOW]),
    });

    const pending = svc.execute(descriptor(), automationSource("rule-1"), flowConfirm(), "observed");
    tracker.observeState(FLOW.id, { litresPerMinute: 120 });
    const result = await pending;

    expect(store.get(result.commandId!)?.transportKind).toBe("hue");
  });

  it("omits identity it cannot resolve rather than inventing a placeholder", async () => {
    const svc = service({ deviceRegistry: undefined });

    const result = await svc.execute(descriptor(), automationSource("rule-1"));

    const record = store.get(result.commandId!);
    expect(record?.targetDeviceName).toBeUndefined();
    expect(record?.transportKind).toBeUndefined();
    // The capability facts are still known without a registry.
    expect(record?.capabilityCeiling).toBe("dispatch");
  });

  it("keeps the snapshot of a clamped over-request truthful about both tiers", async () => {
    // The author asked for `observed` but supplied no observation contract, so the
    // boundary clamps. The record has to show the ask AND the ceiling, otherwise the
    // clamp is invisible and the command looks like it merely chose a low tier.
    const result = await service().execute(
      descriptor(),
      automationSource("rule-1"),
      undefined,
      "observed",
    );

    const record = store.get(result.commandId!);
    expect(record?.requestedTier).toBe("observed");
    expect(record?.effectiveTier).toBe("dispatch");
    expect(record?.capabilityCeiling).toBe("dispatch");
    expect(record?.observationConfigured).toBe(false);
  });

  it("survives a device rename, because the names were copied not referenced", async () => {
    const devices = [{ ...PUMP }, FLOW];
    const svc = service({ deviceRegistry: registry(devices) });

    const result = await svc.execute(descriptor(), automationSource("rule-1"));
    devices[0].name = "Decommissioned Pump";

    expect(store.get(result.commandId!)?.targetDeviceName).toBe("Transfer Pump");
  });
});

describe("CommandService — author intent", () => {
  it("records the author's intent and observation labels", async () => {
    const tracker = new PendingCommandTracker();
    const svc = service({ pendingCommandTracker: tracker });

    const pending = svc.execute(descriptor(), automationSource("rule-1"), flowConfirm(), "observed", {
      intent: "Transfer 500 L",
      observedLabel: "Flow detected",
    });
    tracker.observeState(FLOW.id, { litresPerMinute: 120 });
    const result = await pending;

    const record = store.get(result.commandId!);
    expect(record?.intentLabel).toBe("Transfer 500 L");
    expect(record?.observedLabel).toBe("Flow detected");
  });

  it("sanitises author text on its way to the record", async () => {
    const result = await service().execute(
      descriptor(),
      automationSource("rule-1"),
      undefined,
      undefined,
      { intent: "  Stop\nwater\u0000 transfer  " },
    );

    expect(store.get(result.commandId!)?.intentLabel).toBe("Stop water transfer");
  });

  it("leaves the labels absent when the author supplied none", async () => {
    const result = await service().execute(descriptor(), automationSource("rule-1"));

    const record = store.get(result.commandId!);
    expect(record?.intentLabel).toBeUndefined();
    expect(record?.observedLabel).toBeUndefined();
  });

  it("cannot be used to overstate the tier or the lifecycle state", async () => {
    // The whole point of separating author captions from platform truth: a caption
    // claiming an observation must not change what the command actually proved.
    const result = await service().execute(
      descriptor(),
      automationSource("rule-1"),
      undefined,
      undefined,
      { intent: "OBSERVED — flow confirmed at 120 L/min", observedLabel: "definitely happened" },
    );

    const record = store.get(result.commandId!);
    expect(record?.effectiveTier).toBe("dispatch");
    expect(record?.lifecycleState).toBe("DISPATCHED");
    expect(record?.observationConfigured).toBe(false);
    expect(record?.observedDeviceId).toBeUndefined();
  });
});
