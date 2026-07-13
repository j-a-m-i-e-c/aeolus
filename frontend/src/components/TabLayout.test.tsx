// frontend/src/components/TabLayout.test.tsx — Grid pane host: permissions, rendering, removal

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockDashState, permState, mockGetPaneEntry, mockAuthFetch } = vi.hoisted(() => ({
  mockDashState: {
    panes: [] as Array<Record<string, unknown>>,
    updatePanePosition: vi.fn(),
    updatePaneSize: vi.fn(),
    removePane: vi.fn(),
    addPane: vi.fn(),
  },
  permState: { permission: "write", isAdmin: true, canRead: true, canInteract: true, canWrite: true },
  mockGetPaneEntry: vi.fn(),
  mockAuthFetch: vi.fn(),
}));

// react-grid-layout has heavy DOM/measurement behaviour; replace it with a plain
// container that simply renders the pane children.
vi.mock("react-grid-layout", () => ({
  ResponsiveGridLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="grid">{children}</div>
  ),
  verticalCompactor: {},
}));

vi.mock("./PanePicker", () => ({
  PanePicker: () => <div data-testid="pane-picker">picker</div>,
}));

vi.mock("./PaneConfigPanel", () => ({
  PaneConfigPanel: () => <div data-testid="pane-config">config</div>,
}));

vi.mock("../hooks/useTabPermission", () => ({
  useTabPermission: () => permState,
}));

vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: typeof mockDashState) => unknown) => selector(mockDashState),
}));

vi.mock("../lib/pane-registry", () => ({
  getPaneEntry: mockGetPaneEntry,
}));

vi.mock("../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { TabLayout } from "./TabLayout";

function pane(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    tabId: "tab1",
    paneType: "sensor-panel",
    config: {},
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    createdAt: 0,
    ...overrides,
  };
}

describe("TabLayout", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  beforeEach(() => {
    mockDashState.panes = [pane()];
    mockDashState.removePane.mockReset();
    mockDashState.addPane.mockReset();
    mockGetPaneEntry.mockReset();
    mockGetPaneEntry.mockReturnValue({
      component: () => <div data-testid="pane-body">body</div>,
      displayName: "Sensor Panel",
    });
    permState.canWrite = true;
    permState.canInteract = true;
  });

  it("renders the write controls and pane content for a writable tab", () => {
    render(<TabLayout tabId="tab1" />);
    expect(screen.getByText("New Automation Pane")).toBeInTheDocument();
    expect(screen.getByText("Browse Panes")).toBeInTheDocument();
    expect(screen.getByText("Sensor Panel")).toBeInTheDocument();
    expect(screen.getByTestId("pane-body")).toBeInTheDocument();
  });

  it("hides the write controls when the user cannot write", () => {
    permState.canWrite = false;
    render(<TabLayout tabId="tab1" />);
    expect(screen.queryByText("New Automation Pane")).not.toBeInTheDocument();
    expect(screen.queryByText("Browse Panes")).not.toBeInTheDocument();
    // Content is still rendered
    expect(screen.getByTestId("pane-body")).toBeInTheDocument();
  });

  it("opens the pane picker when 'Browse Panes' is clicked", () => {
    render(<TabLayout tabId="tab1" />);
    expect(screen.queryByTestId("pane-picker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Browse Panes"));
    expect(screen.getByTestId("pane-picker")).toBeInTheDocument();
  });

  it("adds an automation pane when the new-automation button is clicked", () => {
    render(<TabLayout tabId="tab1" />);
    fireEvent.click(screen.getByText("New Automation Pane"));
    expect(mockDashState.addPane).toHaveBeenCalledWith("tab1", "automation");
  });

  it("removes a pane when its remove button is clicked", () => {
    render(<TabLayout tabId="tab1" />);
    fireEvent.click(screen.getByTitle("Remove pane"));
    expect(mockDashState.removePane).toHaveBeenCalledWith("p1");
  });

  it("shows a fallback message for an unknown pane type", () => {
    mockDashState.panes = [pane({ paneType: "mystery" })];
    mockGetPaneEntry.mockReturnValue(undefined);
    render(<TabLayout tabId="tab1" />);
    expect(screen.getByText("Unknown pane type: mystery")).toBeInTheDocument();
  });

  it("only renders panes belonging to the given tab", () => {
    mockDashState.panes = [pane({ id: "p1", tabId: "tab1" }), pane({ id: "p2", tabId: "other" })];
    render(<TabLayout tabId="tab1" />);
    // Two panes total but only one belongs to tab1
    expect(screen.getAllByTestId("pane-body")).toHaveLength(1);
  });
});
