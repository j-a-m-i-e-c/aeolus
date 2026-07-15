// frontend/src/sandbox/runtime/shim.test.tsx — Unit tests for ShimHost + buildPanelProps

import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ShimHost, buildPanelProps } from "./shim";
import type { AeolusUiSdk } from "./sdk-client";
import type { PropsPayload } from "../rpc-types";

function makeMockSdk(overrides?: Partial<PropsPayload>): AeolusUiSdk {
  const props: PropsPayload = {
    entityType: "automation",
    ruleId: "rule-1",
    ruleName: "Test Rule",
    lastFired: null,
    enabled: true,
    devices: [],
    history: [],
    state: { counter: 0 },
    ...overrides,
  };
  const stateMirror = new Map<string, unknown>(Object.entries(props.state));
  const stateListeners = new Set<(key: string, value: unknown) => void>();
  const propsListeners = new Set<(patch: Partial<PropsPayload>) => void>();

  return {
    read: (key: string) => stateMirror.get(key),
    save: vi.fn(async (key: string, value: unknown) => { stateMirror.set(key, value); }),
    saveAndFire: vi.fn(async () => {}),
    fire: vi.fn(async () => {}),
    control: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    subscribeState: (listener) => { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    subscribeProps: (listener) => { propsListeners.add(listener); return () => propsListeners.delete(listener); },
    getProps: () => props,
    dispose: vi.fn(),
    // Expose for test interaction:
    _emitState: (key: string, value: unknown) => { stateMirror.set(key, value); for (const l of stateListeners) l(key, value); },
    _emitProps: (patch: Partial<PropsPayload>) => { Object.assign(props, patch); for (const l of propsListeners) l(patch); },
  } as AeolusUiSdk & { _emitState: (k: string, v: unknown) => void; _emitProps: (p: Partial<PropsPayload>) => void };
}

describe("ShimHost", () => {
  it("renders the wrapped component with reconstructed props", () => {
    const sdk = makeMockSdk();
    const TestComponent = (props: Record<string, unknown>) => (
      <div data-testid="custom">{String(props.ruleName)}</div>
    );

    render(<ShimHost sdk={sdk} entityType="automation" Component={TestComponent} />);
    expect(screen.getByTestId("custom")).toHaveTextContent("Test Rule");
  });

  it("re-renders when a state event arrives", () => {
    const sdk = makeMockSdk() as AeolusUiSdk & { _emitState: (k: string, v: unknown) => void };
    const TestComponent = (props: Record<string, unknown>) => (
      <div data-testid="counter">{String((props as { read: (k: string) => unknown }).read("counter"))}</div>
    );

    render(<ShimHost sdk={sdk} entityType="automation" Component={TestComponent} />);
    expect(screen.getByTestId("counter")).toHaveTextContent("0");

    act(() => sdk._emitState("counter", 42));
    expect(screen.getByTestId("counter")).toHaveTextContent("42");
  });

  it("re-renders when a props patch arrives", () => {
    const sdk = makeMockSdk() as AeolusUiSdk & { _emitProps: (p: Partial<PropsPayload>) => void };
    const TestComponent = (props: Record<string, unknown>) => (
      <div data-testid="enabled">{String(props.enabled)}</div>
    );

    render(<ShimHost sdk={sdk} entityType="automation" Component={TestComponent} />);
    expect(screen.getByTestId("enabled")).toHaveTextContent("true");

    act(() => sdk._emitProps({ enabled: false }));
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });
});

describe("buildPanelProps", () => {
  it("maps SDK methods to panel prop names", () => {
    const sdk = makeMockSdk({ entityType: "panel", ruleId: "panel-1", ruleName: "My Panel" });
    const props = buildPanelProps(sdk);

    expect(props.panelId).toBe("panel-1");
    expect(props.panelName).toBe("My Panel");
    expect(typeof props.deviceAction).toBe("function");
    expect(typeof props.mqttPublish).toBe("function");
    expect(typeof props.stateSet).toBe("function");
    expect(props.state).toBeInstanceOf(Map);
  });

  it("deviceAction calls sdk.control", () => {
    const sdk = makeMockSdk();
    const props = buildPanelProps(sdk);
    props.deviceAction("light-1", "toggle", { level: 50 });
    expect(sdk.control).toHaveBeenCalledWith("light-1", "toggle", { level: 50 });
  });

  it("mqttPublish calls sdk.publish", () => {
    const sdk = makeMockSdk();
    const props = buildPanelProps(sdk);
    props.mqttPublish("home/test", "payload");
    expect(sdk.publish).toHaveBeenCalledWith("home/test", "payload");
  });
});
