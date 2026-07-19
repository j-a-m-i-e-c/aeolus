// frontend/src/components/panes/AutomationPane.test.tsx — self-contained automation pane
//
// Covers the three modes (setup / status / editing) and their branches. All the
// heavy children (Monaco editors, flow diagram, activity feed, snippet picker,
// dynamic custom component) and the zustand stores are mocked so the pane's own
// logic — fetching, save/update/toggle/fire, mode transitions, error/notFound —
// runs in jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));
vi.mock("../../lib/env", () => ({ API_URL: "http://test.local:3001" }));

// Heavy child stubs
vi.mock("../ScriptEditor", () => ({
  ScriptEditor: ({ onSave }: { onSave: (s: string) => void }) => (
    <div data-testid="script-editor">
      <button onClick={() => onSave("src")}>logic-save</button>
    </div>
  ),
}));
vi.mock("../UiEditor", () => ({ UiEditor: () => <div data-testid="ui-editor" /> }));
vi.mock("../FlowDiagram", () => ({ FlowDiagram: () => <div data-testid="flow-diagram" /> }));
vi.mock("../ActivityFeed", () => ({ ActivityFeed: () => <div data-testid="activity-feed" /> }));
vi.mock("../SnippetPicker", () => ({
  SnippetPicker: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="snippet-picker">
      <button onClick={onClose}>close-snippets</button>
    </div>
  ),
}));
vi.mock("../CustomComponentBoundary", () => ({
  CustomComponentBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="custom-boundary">{children}</div>
  ),
}));
vi.mock("../TriggerSelector", () => ({
  TriggerSelector: ({ onMqttTopicChange }: { onMqttTopicChange: (v: string) => void }) => (
    <input data-testid="trigger-selector" onChange={(e) => onMqttTopicChange(e.target.value)} />
  ),
}));

vi.mock("../../sandbox/SandboxHost", () => ({
  SandboxHost: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div data-testid="sandbox-host" data-entity-type={entityType} data-entity-id={entityId} />
  ),
}));

const updatePaneConfig = vi.fn();
vi.mock("../../store/dashboard-store", () => ({
  useDashboardStore: (sel: (s: { updatePaneConfig: typeof updatePaneConfig }) => unknown) =>
    sel({ updatePaneConfig }),
}));
vi.mock("../../store/device-store", () => ({
  useDeviceStore: (sel: (s: { devices: Record<string, unknown> }) => unknown) => sel({ devices: {} }),
}));
vi.mock("../../store/automation-state-store", () => {
  const store = (sel: (s: { stateByRule: Record<string, unknown> }) => unknown) => sel({ stateByRule: {} });
  (store as unknown as { getState: () => unknown }).getState = () => ({ initRuleState: vi.fn() });
  return { useAutomationStateStore: store, sendStateUpdate: vi.fn(), sendStateUpdateAndFire: vi.fn() };
});

import { AutomationPane } from "./AutomationPane";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function lastCallWithMethod(method: string) {
  return [...mockAuthFetch.mock.calls].reverse().find(([, init]) => (init?.method ?? "GET") === method);
}

const RULE = {
  id: "r1",
  name: "My Rule",
  topic: "a/b",
  ruleType: "script",
  enabled: true,
  triggerType: "mqtt" as const,
};

/** Route status-mode reads by URL; single rule in the list by default. */
function routeStatus(rule: Record<string, unknown> = RULE) {
  mockAuthFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method) return Promise.resolve(jsonResponse({ id: "r1" }));
    if (url.endsWith("/api/automations")) return Promise.resolve(jsonResponse([rule]));
    if (url.includes("/history")) return Promise.resolve(jsonResponse([{ timestamp: 1000 }]));
    if (url.includes("/state")) return Promise.resolve(jsonResponse({}));
    return Promise.resolve(jsonResponse({}));
  });
}

describe("AutomationPane — setup mode", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    updatePaneConfig.mockClear();
  });

  it("renders the setup form with the logic editor and a disabled Save", async () => {
    render(<AutomationPane config={{} as PaneConfig} paneId="p1" />);
    expect(screen.getByPlaceholderText("Automation name")).toBeInTheDocument();
    expect(await screen.findByTestId("script-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables Save once a name is entered and POSTs a new automation", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ id: "new-1" }));
    render(<AutomationPane config={{} as PaneConfig} paneId="p1" />);

    fireEvent.change(screen.getByPlaceholderText("Automation name"), { target: { value: "Heat logic" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    const [url, init] = lastCallWithMethod("POST")!;
    expect(url).toBe("http://test.local:3001/api/automations");
    expect(JSON.parse(init!.body as string)).toMatchObject({ name: "Heat logic", ruleType: "script" });
    await waitFor(() =>
      expect(updatePaneConfig).toHaveBeenCalledWith("p1", expect.objectContaining({ ruleId: "new-1", ruleName: "Heat logic" })),
    );
  });

  it("switches to the UI tab and toggles the snippets/docs panels", async () => {
    render(<AutomationPane config={{} as PaneConfig} paneId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "UI" }));
    expect(await screen.findByTestId("ui-editor")).toBeInTheDocument();

    // Snippets panel is open by default; close it via its own control.
    expect(screen.getByTestId("snippet-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-snippets"));
    expect(screen.queryByTestId("snippet-picker")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(screen.getByText("Component Props")).toBeInTheDocument();
  });

  it("renders server transpile errors on a 400 save", async () => {
    mockAuthFetch.mockResolvedValue(
      jsonResponse({ details: [{ line: 2, column: 4, message: "boom" }] }, 400),
    );
    render(<AutomationPane config={{} as PaneConfig} paneId="p1" />);
    fireEvent.change(screen.getByPlaceholderText("Automation name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Transpilation errors")).toBeInTheDocument();
    expect(screen.getByText(/Line 2:4 — boom/)).toBeInTheDocument();
  });
});

describe("AutomationPane — status mode", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    updatePaneConfig.mockClear();
  });

  it("loads the rule and shows its topic + activity feed (no ui/structured)", async () => {
    routeStatus();
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} paneId="p1" />);
    expect(await screen.findByText("a/b")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
  });

  it("toggles the rule via PATCH", async () => {
    routeStatus();
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} />);
    await screen.findByText("a/b");
    fireEvent.click(screen.getByRole("button", { name: "Enabled" }));
    await waitFor(() => expect(lastCallWithMethod("PATCH")).toBeTruthy());
    expect(lastCallWithMethod("PATCH")![0]).toBe("http://test.local:3001/api/automations/r1/toggle");
  });

  it("fires the rule via POST", async () => {
    routeStatus();
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} />);
    await screen.findByText("a/b");
    fireEvent.click(screen.getByRole("button", { name: "Fire Now" }));
    await waitFor(() => expect(lastCallWithMethod("POST")).toBeTruthy());
    expect(lastCallWithMethod("POST")![0]).toBe("http://test.local:3001/api/automations/r1/fire");
  });

  it("enters editing mode and updates via PUT", async () => {
    routeStatus();
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} paneId="p1" />);
    await screen.findByText("a/b");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    // Editing mode: name is populated and a Cancel button appears.
    expect(screen.getByDisplayValue("My Rule")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastCallWithMethod("PUT")).toBeTruthy());
    expect(lastCallWithMethod("PUT")![0]).toBe("http://test.local:3001/api/automations/r1");
  });

  it("renders a flow diagram for a structured rule", async () => {
    routeStatus({ ...RULE, structured: { trigger: "t", conditions: [], actions: [] } });
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} />);
    expect(await screen.findByTestId("flow-diagram")).toBeInTheDocument();
  });

  it("renders SandboxHost with entityType=automation and the rule id when uiSource present", async () => {
    routeStatus({ ...RULE, uiSource: "export default () => null" });
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} />);
    const host = await screen.findByTestId("sandbox-host");
    expect(host).toBeInTheDocument();
    expect(host).toHaveAttribute("data-entity-type", "automation");
    expect(host).toHaveAttribute("data-entity-id", "r1");
  });

  it("shows the not-found state and resets the pane", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.endsWith("/api/automations")) return Promise.resolve(jsonResponse([])); // rule missing
      return Promise.resolve(jsonResponse([]));
    });
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} paneId="p1" />);
    expect(await screen.findByText("Rule not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset Pane" }));
    expect(updatePaneConfig).toHaveBeenCalledWith("p1", expect.objectContaining({ ruleId: "" }));
  });

  it("shows the fetch-error state and retries", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.endsWith("/api/automations")) return Promise.resolve(jsonResponse({ error: "nope" }, 500));
      return Promise.resolve(jsonResponse([]));
    });
    render(<AutomationPane config={{ ruleId: "r1" } as unknown as PaneConfig} />);
    expect(await screen.findByText("Failed to load automation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
