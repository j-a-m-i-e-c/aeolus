// frontend/src/sandbox/sandbox-host.subscriptions.test.ts
//
// sandbox-host.test.ts covers the deps wiring and the panel no-op paths, and proves
// one state change reaches the frame. This file covers the rules that wiring exists
// to enforce:
//
//   - a frame is told about a key only when its value actually changed;
//   - a burst inside one frame costs one message, carrying the newest value;
//   - a store notification that did not change this entity's slice costs nothing;
//   - nothing is posted into a port after the frame is unregistered;
//   - the command feed follows the same rules, keeping only the latest array;
//   - a failed device action resolves as an unsuccessful result rather than rejecting
//     into the frame.
//
// The last one is the sandbox contract: the frame may not see host exceptions, so a
// network failure has to arrive as data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type StateListener = (state: { stateByRule: Record<string, Record<string, unknown>> }) => void;
type CommandListener = (state: { activityByRule: Record<string, unknown[]> }) => void;

const h = vi.hoisted(() => ({
  authFetch: vi.fn(),
  sendStateUpdate: vi.fn(),
  sendStateUpdateAndFire: vi.fn(),
  stateStore: { stateByRule: {} as Record<string, Record<string, unknown>> },
  commandStore: { activityByRule: {} as Record<string, unknown[]> },
  stateListeners: [] as StateListener[],
  commandListeners: [] as CommandListener[],
  stateUnsubscribe: vi.fn(),
  commandUnsubscribe: vi.fn(),
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: h.authFetch }));
vi.mock("../lib/env", () => ({ API_URL: "http://test:3001" }));

vi.mock("../store/automation-state-store", () => ({
  sendStateUpdate: (...args: unknown[]) => h.sendStateUpdate(...args),
  sendStateUpdateAndFire: (...args: unknown[]) => h.sendStateUpdateAndFire(...args),
  useAutomationStateStore: Object.assign(() => h.stateStore, {
    getState: () => h.stateStore,
    subscribe: (listener: StateListener) => {
      h.stateListeners.push(listener);
      return h.stateUnsubscribe;
    },
  }),
}));

vi.mock("../store/command-activity-store", () => ({
  useCommandActivityStore: Object.assign(() => h.commandStore, {
    getState: () => h.commandStore,
    subscribe: (listener: CommandListener) => {
      h.commandListeners.push(listener);
      return h.commandUnsubscribe;
    },
  }),
}));

import { sandboxBroker } from "./sandbox-host";

function createFakePort(): MessagePort {
  return {
    postMessage: vi.fn(),
    onmessage: null,
    onmessageerror: null,
    close: vi.fn(),
    start: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MessagePort;
}

/** Events of one kind that reached the frame, oldest first. */
function eventsOf(port: MessagePort, event: "state" | "commands") {
  return (port.postMessage as ReturnType<typeof vi.fn>).mock.calls
    .map((call) => call[0] as { kind?: string; event?: string; data?: unknown })
    .filter((msg) => msg.kind === "event" && msg.event === event)
    .map((msg) => msg.data);
}

let frameSeq = 0;

describe("sandbox-host — live subscriptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.authFetch.mockReset();
    h.authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    h.stateStore = { stateByRule: { "rule-1": { temp: 22 } } };
    h.commandStore = { activityByRule: { "rule-1": [{ commandId: "cmd-0" }] } };
    h.stateListeners.length = 0;
    h.commandListeners.length = 0;
    h.stateUnsubscribe.mockClear();
    h.commandUnsubscribe.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Register a frame and return its port plus the captured store listeners. */
  function registerFrame(entityType: "automation" | "panel" = "automation") {
    const port = createFakePort();
    const grant = {
      frameId: `frame-${++frameSeq}`,
      entityType,
      entityId: "rule-1",
      port,
    } as const;
    sandboxBroker.register(grant);
    return {
      port,
      grant,
      notifyState: h.stateListeners.at(-1)!,
      notifyCommands: h.commandListeners.at(-1)!,
    };
  }

  /** Let the coalescing frame elapse. */
  const flush = () => vi.advanceTimersByTime(30);

  describe("state changes", () => {
    it("forwards only the keys whose values actually changed", () => {
      const { port, notifyState } = registerFrame();

      // `temp` is unchanged; only `mode` is news.
      notifyState({ stateByRule: { "rule-1": { temp: 22, mode: "auto" } } });
      flush();

      expect(eventsOf(port, "state")).toEqual([{ key: "mode", value: "auto" }]);
    });

    it("costs one message per key when several changes land in the same frame", () => {
      const { port, notifyState } = registerFrame();

      notifyState({ stateByRule: { "rule-1": { temp: 23 } } });
      notifyState({ stateByRule: { "rule-1": { temp: 24 } } });
      notifyState({ stateByRule: { "rule-1": { temp: 25 } } });
      flush();

      // Three store notifications, one message, carrying the newest value: the
      // frame is not owed the intermediate steps of a level.
      expect(eventsOf(port, "state")).toEqual([{ key: "temp", value: 25 }]);
    });

    it("says nothing when a store notification leaves this entity's slice untouched", () => {
      const { port, notifyState } = registerFrame();
      const slice = h.stateStore.stateByRule["rule-1"]!;

      // Another automation changed; the reference for this one is identical.
      notifyState({ stateByRule: { "rule-1": slice, "rule-2": { other: 1 } } });
      flush();

      expect(eventsOf(port, "state")).toEqual([]);
    });

    it("says nothing when a new slice object holds the same values", () => {
      const { port, notifyState } = registerFrame();

      // A fresh object, so reference equality does not save us — the per-key
      // comparison has to.
      notifyState({ stateByRule: { "rule-1": { temp: 22 } } });
      flush();

      expect(eventsOf(port, "state")).toEqual([]);
    });

    it("treats a disappearing slice as no state rather than crashing", () => {
      const { port, notifyState } = registerFrame();

      notifyState({ stateByRule: {} });
      flush();

      expect(eventsOf(port, "state")).toEqual([]);
    });

    it("posts nothing into a port whose frame has gone", () => {
      const { port, grant, notifyState } = registerFrame();

      sandboxBroker.unregister(grant.frameId);
      notifyState({ stateByRule: { "rule-1": { temp: 99 } } });
      flush();

      expect(eventsOf(port, "state")).toEqual([]);
      expect(h.stateUnsubscribe).toHaveBeenCalled();
      expect(h.commandUnsubscribe).toHaveBeenCalled();
    });

    it("drops a change already pending when the frame goes away before the flush", () => {
      const { port, grant, notifyState } = registerFrame();

      notifyState({ stateByRule: { "rule-1": { temp: 40 } } });
      sandboxBroker.unregister(grant.frameId);
      flush();

      expect(eventsOf(port, "state")).toEqual([]);
    });
  });

  describe("command activity", () => {
    it("forwards the latest activity array when it is replaced", () => {
      const { port, notifyCommands } = registerFrame();

      notifyCommands({ activityByRule: { "rule-1": [{ commandId: "cmd-1" }] } });
      flush();

      expect(eventsOf(port, "commands")).toEqual([{ commands: [{ commandId: "cmd-1" }] }]);
    });

    it("keeps only the newest array when several arrive in one frame", () => {
      const { port, notifyCommands } = registerFrame();

      notifyCommands({ activityByRule: { "rule-1": [{ commandId: "a" }] } });
      notifyCommands({ activityByRule: { "rule-1": [{ commandId: "b" }] } });
      flush();

      // The store replaces the whole array, so there is no per-key merge to do and
      // an older array is simply stale.
      expect(eventsOf(port, "commands")).toEqual([{ commands: [{ commandId: "b" }] }]);
    });

    it("says nothing when the activity array is the same reference", () => {
      const { port, notifyCommands } = registerFrame();
      const same = h.commandStore.activityByRule["rule-1"]!;

      notifyCommands({ activityByRule: { "rule-1": same } });
      flush();

      expect(eventsOf(port, "commands")).toEqual([]);
    });

    it("treats an entity with no activity as an empty feed", () => {
      const { port, notifyCommands } = registerFrame();

      notifyCommands({ activityByRule: {} });
      flush();

      expect(eventsOf(port, "commands")).toEqual([{ commands: [] }]);
    });

    it("posts no activity into a port whose frame has gone", () => {
      const { port, grant, notifyCommands } = registerFrame();

      notifyCommands({ activityByRule: { "rule-1": [{ commandId: "late" }] } });
      sandboxBroker.unregister(grant.frameId);
      flush();

      expect(eventsOf(port, "commands")).toEqual([]);
    });

    it("gives a panel frame no command feed at all", async () => {
      // A panel does not own an automation, so it has no commands of its own and
      // must not be able to read another entity's.
      const { grant } = registerFrame("panel");

      await sandboxBroker.handleMessage(grant as never, {
        channel: "aeolus-sdk",
        kind: "request",
        id: "r-commands",
        op: "commands",
        params: {},
      } as never);

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .find((m) => m.kind === "response");
      expect(response.result).toEqual([]);
    });

    it("answers an automation frame's command read from the live store", async () => {
      const { grant } = registerFrame();

      await sandboxBroker.handleMessage(grant as never, {
        channel: "aeolus-sdk",
        kind: "request",
        id: "r-commands",
        op: "commands",
        params: {},
      } as never);

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .find((m) => m.kind === "response");
      expect(response.result).toEqual([{ commandId: "cmd-0" }]);
    });
  });

  describe("scheduling", () => {
    it("still delivers where requestAnimationFrame does not exist", () => {
      // jsdom has rAF, a Pi kiosk browser in a background tab may not run it, and
      // the fallback is what keeps state flowing either way.
      const original = globalThis.requestAnimationFrame;
      // @ts-expect-error — deliberately removing the API for this test
      delete globalThis.requestAnimationFrame;
      try {
        const { port, notifyState } = registerFrame();
        notifyState({ stateByRule: { "rule-1": { temp: 31 } } });
        vi.advanceTimersByTime(20);
        expect(eventsOf(port, "state")).toEqual([{ key: "temp", value: 31 }]);
      } finally {
        globalThis.requestAnimationFrame = original;
      }
    });
  });

  describe("device control failures", () => {
    it("resolves a network failure as an unsuccessful result rather than throwing into the frame", async () => {
      h.authFetch.mockRejectedValue(new Error("connection refused"));
      const { grant } = registerFrame();

      await sandboxBroker.handleMessage(grant as never, {
        channel: "aeolus-sdk",
        kind: "request",
        id: "r-control",
        op: "control",
        params: { deviceId: "valve-1", actionType: "toggle" },
      } as never);

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .find((m) => m.kind === "response");
      expect(response.ok).toBe(true);
      expect(response.result).toEqual({ success: false, error: "connection refused" });
    });

    it("names the failure generically when it is not an Error", async () => {
      h.authFetch.mockRejectedValue("socket hang up");
      const { grant } = registerFrame();

      await sandboxBroker.handleMessage(grant as never, {
        channel: "aeolus-sdk",
        kind: "request",
        id: "r-control",
        op: "control",
        params: { deviceId: "valve-1", actionType: "toggle" },
      } as never);

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .find((m) => m.kind === "response");
      expect(response.result).toEqual({ success: false, error: "Control request failed" });
    });
  });
});
