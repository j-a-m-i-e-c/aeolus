// frontend/src/components/Sidebar.test.tsx — sidebar navigation, tab CRUD, permissions, health

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const {
  mockNavigate,
  mockLocation,
  deviceState,
  dashboardState,
  dataStoreState,
  authState,
  permissionsState,
  mockFetchHealth,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: "/dashboard" } as { pathname: string },
  deviceState: {} as any,
  dashboardState: {} as any,
  dataStoreState: {} as any,
  authState: {} as any,
  permissionsState: {} as any,
  mockFetchHealth: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: any) => unknown) => selector(deviceState),
}));

// tabNameToSlug is used directly by the component; provide a real implementation.
function tabNameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

vi.mock("../store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: any) => unknown) => selector(dashboardState),
  tabNameToSlug,
}));

vi.mock("../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(dataStoreState),
}));

vi.mock("../store/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(authState),
}));

vi.mock("../store/permissions-store", () => ({
  usePermissionsStore: (selector: (s: any) => unknown) => selector(permissionsState),
}));

vi.mock("../lib/api-client", () => ({
  fetchHealth: mockFetchHealth,
}));

import { Sidebar } from "./Sidebar";

function makeTab(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    name: "Living Room",
    icon: "home",
    order: 0,
    pinned: false,
    createdAt: 0,
    ...overrides,
  };
}

const PINNED = [
  { id: "default-dashboard", name: "Dashboard", icon: "home", order: 0, pinned: true },
  { id: "default-connectors", name: "Connectors", icon: "server", order: 1, pinned: true },
  { id: "default-data-store", name: "Data Store", icon: "database", order: 2, pinned: true },
  { id: "default-security", name: "Security", icon: "shield", order: 3, pinned: true },
];

function resetState() {
  Object.assign(deviceState, {
    wsConnected: true,
    health: { mqtt: "connected" },
    setHealth: vi.fn(),
  });
  Object.assign(dashboardState, {
    tabs: [...PINNED],
    addTab: vi.fn(),
    renameTab: vi.fn(),
    reorderTabs: vi.fn(),
    deleteTab: vi.fn(),
  });
  Object.assign(dataStoreState, {
    config: { enabled: true },
    enabled: true,
    fetchConfig: vi.fn().mockResolvedValue(undefined),
  });
  Object.assign(authState, {
    user: { username: "alice", role: "admin" },
    logout: vi.fn(),
  });
  Object.assign(permissionsState, {
    hasTabAccess: vi.fn(() => true),
  });
}

describe("Sidebar", () => {
  beforeEach(() => {
    resetState();
    mockNavigate.mockReset();
    mockLocation.pathname = "/dashboard";
    // fetchHealth rejects (swallowed by the component) so no async state update leaks.
    mockFetchHealth.mockRejectedValue(new Error("offline"));
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the brand and all pinned tabs for an admin", () => {
    render(<Sidebar />);
    expect(screen.getByText("Aeolus")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Connectors")).toBeInTheDocument();
    expect(screen.getByText("Data Store")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
  });

  it("shows MQTT connected and WebSocket live indicators from device state", () => {
    render(<Sidebar />);
    expect(screen.getByText("MQTT Connected")).toBeInTheDocument();
    expect(screen.getByText("WebSocket Live")).toBeInTheDocument();
  });

  it("shows disconnected/offline indicators when device state is down", () => {
    deviceState.wsConnected = false;
    deviceState.health = { mqtt: "disconnected" };
    render(<Sidebar />);
    expect(screen.getByText("MQTT Disconnected")).toBeInTheDocument();
    expect(screen.getByText("WebSocket Offline")).toBeInTheDocument();
  });

  it("navigates to the pinned route when a pinned tab is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Connectors"));
    expect(mockNavigate).toHaveBeenCalledWith("/connectors");
  });

  it("renders custom tabs and navigates to their slug route on click", () => {
    dashboardState.tabs = [...PINNED, makeTab({ id: "c1", name: "Living Room" })];
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Living Room"));
    expect(mockNavigate).toHaveBeenCalledWith("/tab/living-room");
  });

  it("hides the Security tab and Add Tab control for non-admin users", () => {
    authState.user = { username: "bob", role: "viewer" };
    permissionsState.hasTabAccess = vi.fn(() => true);
    render(<Sidebar />);
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Tab" })).not.toBeInTheDocument();
  });

  it("filters custom tabs by permission for non-admin users", () => {
    authState.user = { username: "bob", role: "viewer" };
    dashboardState.tabs = [
      ...PINNED,
      makeTab({ id: "c1", name: "Allowed" }),
      makeTab({ id: "c2", name: "Denied", order: 1 }),
    ];
    permissionsState.hasTabAccess = vi.fn((id: string) => id === "c1");
    render(<Sidebar />);
    expect(screen.getByText("Allowed")).toBeInTheDocument();
    expect(screen.queryByText("Denied")).not.toBeInTheDocument();
  });

  it("opens the add-tab form and creates a tab on submit", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Add Tab" }));
    const input = screen.getByPlaceholderText("Tab name…");
    fireEvent.change(input, { target: { value: "Garage" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(dashboardState.addTab).toHaveBeenCalledWith("Garage", "cpu");
    expect(mockNavigate).toHaveBeenCalledWith("/tab/garage");
  });

  it("blocks duplicate tab names with a warning and disabled Add button", () => {
    dashboardState.tabs = [...PINNED, makeTab({ id: "c1", name: "Living Room" })];
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Add Tab" }));
    fireEvent.change(screen.getByPlaceholderText("Tab name…"), {
      target: { value: "Living Room" },
    });
    expect(screen.getByText("A tab with this name already exists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(dashboardState.addTab).not.toHaveBeenCalled();
  });

  it("cancels the add-tab form without creating a tab", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Add Tab" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Tab name…")).not.toBeInTheDocument();
    expect(dashboardState.addTab).not.toHaveBeenCalled();
  });

  it("renames a custom tab on double-click + Enter (admin only)", () => {
    dashboardState.tabs = [...PINNED, makeTab({ id: "c1", name: "Living Room" })];
    render(<Sidebar />);
    fireEvent.doubleClick(screen.getByText("Living Room"));
    const input = screen.getByDisplayValue("Living Room");
    fireEvent.change(input, { target: { value: "Lounge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dashboardState.renameTab).toHaveBeenCalledWith("c1", "Lounge");
  });

  it("deletes a custom tab after confirmation", () => {
    dashboardState.tabs = [...PINNED, makeTab({ id: "c1", name: "Living Room" })];
    render(<Sidebar />);
    const tab = screen.getByText("Living Room").closest("div") as HTMLElement;
    const delBtn = within(tab).getByTitle("Delete tab");
    fireEvent.click(delBtn);
    expect(window.confirm).toHaveBeenCalled();
    expect(dashboardState.deleteTab).toHaveBeenCalledWith("c1");
  });

  it("does not delete when confirmation is dismissed", () => {
    window.confirm = vi.fn(() => false);
    dashboardState.tabs = [...PINNED, makeTab({ id: "c1", name: "Living Room" })];
    render(<Sidebar />);
    const tab = screen.getByText("Living Room").closest("div") as HTMLElement;
    fireEvent.click(within(tab).getByTitle("Delete tab"));
    expect(dashboardState.deleteTab).not.toHaveBeenCalled();
  });

  it("shows the disabled dot on the Data Store tab when data store is off", () => {
    dataStoreState.config = { enabled: false };
    dataStoreState.enabled = false;
    render(<Sidebar />);
    expect(screen.getByTitle("Data Store is disabled")).toBeInTheDocument();
  });

  it("renders the current user and triggers logout", () => {
    render(<Sidebar />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Sign out"));
    expect(authState.logout).toHaveBeenCalled();
  });
});
