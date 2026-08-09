// src/automations/pending-command-tracker.transition.test.ts
// phase-1-runtime-foundations Task 4 — tracker reports the intermediate
// ACKNOWLEDGED milestone (observed tier) via onTransition, carrying commandId.

import { describe, it, expect, vi } from "vitest";
import { PendingCommandTracker, type PendingCommandTransition } from "./pending-command-tracker.js";

describe("PendingCommandTracker onTransition (Req 3.5)", () => {
  it("emits an intermediate ACKNOWLEDGED for an observed-tier command", async () => {
    const events: PendingCommandTransition[] = [];
    const tracker = new PendingCommandTracker({ onTransition: (e) => events.push(e) });

    const promise = tracker.register({
      commandId: "c1",
      correlationId: "k1",
      targetDeviceId: "dev-1",
      observedDeviceId: "dev-1",
      requiredTier: "observed",
      condition: (s) => s.on === true,
      timeoutMs: 10_000,
    });

    // Ack arrives before observation → intermediate milestone.
    tracker.route({ correlationId: "k1", success: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      commandId: "c1",
      correlationId: "k1",
      targetDeviceId: "dev-1",
      fromState: "DISPATCHED",
      toState: "ACKNOWLEDGED",
    });

    // Observation completes the command.
    tracker.observeState("dev-1", { on: true });
    const resolution = await promise;
    expect(resolution.lifecycleState).toBe("OBSERVED");
    // Still only the single intermediate emission.
    expect(events).toHaveLength(1);
  });

  it("does NOT emit an intermediate transition for an ack-tier command (it is terminal)", async () => {
    const onTransition = vi.fn();
    const tracker = new PendingCommandTracker({ onTransition });

    const promise = tracker.register({
      commandId: "c2",
      correlationId: "k2",
      targetDeviceId: "dev-2",
      observedDeviceId: "dev-2",
      requiredTier: "acknowledged",
      timeoutMs: 10_000,
    });

    tracker.route({ correlationId: "k2", success: true });
    const resolution = await promise;
    expect(resolution.lifecycleState).toBe("ACKNOWLEDGED");
    expect(onTransition).not.toHaveBeenCalled();
  });

  it("emits the intermediate ACKNOWLEDGED at most once for duplicate acks", async () => {
    const events: PendingCommandTransition[] = [];
    const tracker = new PendingCommandTracker({ onTransition: (e) => events.push(e) });

    const promise = tracker.register({
      commandId: "c3",
      correlationId: "k3",
      targetDeviceId: "dev-3",
      observedDeviceId: "dev-3",
      requiredTier: "observed",
      condition: (s) => s.on === true,
      timeoutMs: 10_000,
    });

    tracker.route({ correlationId: "k3", success: true });
    tracker.route({ correlationId: "k3", success: true });
    tracker.route({ correlationId: "k3", success: true });
    expect(events).toHaveLength(1);

    tracker.observeState("dev-3", { on: true });
    await promise;
    expect(events).toHaveLength(1);
  });
});
