// frontend/src/store/automation-state-store.test.ts — Unit tests for the automation-state store

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import {
  useAutomationStateStore,
  sendStateUpdate,
  sendStateUpdateAndFire,
} from "./automation-state-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useAutomationStateStore.getState();

describe("automation-state-store reducers", () => {
  beforeEach(() => {
    useAutomationStateStore.setState({ stateByRule: {} });
  });

  it("setRuleState merges a key into the rule's state", () => {
    s().setRuleState("r1", "count", 1);
    s().setRuleState("r1", "label", "hi");
    expect(s().stateByRule.r1).toEqual({ count: 1, label: "hi" });
  });

  it("initRuleState replaces the whole snapshot for a rule", () => {
    s().setRuleState("r1", "count", 1);
    s().initRuleState("r1", { fresh: true });
    expect(s().stateByRule.r1).toEqual({ fresh: true });
  });

  it("clearRuleState removes only the targeted rule", () => {
    s().initRuleState("r1", { a: 1 });
    s().initRuleState("r2", { b: 2 });
    s().clearRuleState("r1");
    expect(s().stateByRule).toEqual({ r2: { b: 2 } });
  });
});

describe("sendStateUpdate / sendStateUpdateAndFire", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("PUTs the key/value to the rule's state endpoint", () => {
    sendStateUpdate("r1", "theme", "dark");

    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("http://test.local:3001/api/automations/r1/state");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ key: "theme", value: "dark" });
  });

  it("does not throw when the request rejects (silent degrade)", () => {
    mockAuthFetch.mockRejectedValue(new Error("offline"));
    expect(() => sendStateUpdate("r1", "k", "v")).not.toThrow();
  });

  it("sendStateUpdateAndFire persists and then fires the rule", () => {
    sendStateUpdateAndFire("r1", "k", 5);

    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    const urls = mockAuthFetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain("http://test.local:3001/api/automations/r1/state");
    expect(urls).toContain("http://test.local:3001/api/automations/r1/fire");

    const fireCall = mockAuthFetch.mock.calls.find((c) => String(c[0]).endsWith("/fire"));
    const fireBody = JSON.parse(fireCall![1]?.body as string);
    expect(fireBody.context.topic).toBe("ui/r1/state-set");
    expect(fireBody.context.state).toEqual({ key: "k", value: 5 });
  });
});
