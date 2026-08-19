// frontend/src/App.test.tsx — Auth-guard routing: loading / setup / login / authenticated

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

// --- Auth store: a controllable state object the selector reads from ---
const authState: {
  loading: boolean;
  needsSetup: boolean;
  isAuthenticated: boolean;
  user: { username: string; role: string } | null;
  checkSetupNeeded: ReturnType<typeof vi.fn>;
} = {
  loading: true,
  needsSetup: false,
  isAuthenticated: false,
  user: null,
  checkSetupNeeded: vi.fn(),
};

vi.mock("./store/auth-store", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// --- Stub the page/screen components so we only test the guard's branching ---
vi.mock("./pages/SetupPage", () => ({ SetupPage: () => <div>setup-page</div> }));
vi.mock("./pages/LoginPage", () => ({ LoginPage: () => <div>login-page</div> }));

// The authenticated tree pulls in many stores/effects; stub the heavy pieces.
vi.mock("./components/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("./components/ToastContainer", () => ({ ToastContainer: () => null }));
// CommandPalette exposes onSelectDevice; the stub lets a test drive device selection.
vi.mock("./components/CommandPalette", () => ({
  CommandPalette: ({ onSelectDevice }: { onSelectDevice: (id: string) => void }) => (
    <button onClick={() => onSelectDevice("dev-1")}>open-device</button>
  ),
}));
// DeviceDetail stub exposes onClose so the authenticated app's close handler is exercised.
vi.mock("./components/DeviceDetail", () => ({
  DeviceDetail: ({ deviceId, onClose }: { deviceId: string; onClose: () => void }) => (
    <div>
      <span>device-{deviceId}</span>
      <button onClick={onClose}>close-device</button>
    </div>
  ),
}));
vi.mock("./components/WelcomeScreen", () => ({ WelcomeScreen: () => <div>welcome</div> }));
vi.mock("./components/SystemPage", () => ({ SystemPage: () => <div>system</div> }));

const setDevices = vi.fn();
vi.mock("./store/device-store", () => ({
  useDeviceStore: (selector: (s: { devices: Record<string, unknown>; setDevices: typeof setDevices }) => unknown) =>
    selector({ devices: {}, setDevices }),
}));

const initialize = vi.fn();
vi.mock("./store/dashboard-store", () => ({
  useDashboardStore: (selector: (s: { initialized: boolean; initialize: typeof initialize; tabs: unknown[] }) => unknown) =>
    selector({ initialized: true, initialize, tabs: [] }),
  tabNameToSlug: (n: string) => n,
}));

const fetchPermissions = vi.fn();
// vi.hoisted: these are referenced inside hoisted vi.mock factories, so they
// must be initialized before the factories run (a plain const would hit a TDZ).
const { fetchDevices, permState } = vi.hoisted(() => ({
  fetchDevices: vi.fn(),
  permState: { loaded: true } as { loaded: boolean },
}));
vi.mock("./store/permissions-store", () => ({
  usePermissionsStore: (selector: (s: { fetchPermissions: typeof fetchPermissions; loaded: boolean }) => unknown) =>
    selector({ fetchPermissions, loaded: permState.loaded }),
}));

vi.mock("./lib/ws-client", () => ({ connectWebSocket: vi.fn(), disconnectWebSocket: vi.fn() }));
vi.mock("./lib/api-client", () => ({ fetchDevices }));

// react-router: render children; provide the hooks App imports.
vi.mock("react-router-dom", () => ({
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: ({ element }: { element?: React.ReactNode }) => <>{element}</>,
  Navigate: () => <div>navigate</div>,
  useParams: () => ({}),
}));

import App from "./App";

describe("App auth guard", () => {
  beforeEach(() => {
    authState.loading = true;
    authState.needsSetup = false;
    authState.isAuthenticated = false;
    authState.user = null;
    authState.checkSetupNeeded.mockReset();
    permState.loaded = true;
    setDevices.mockClear();
    initialize.mockClear();
    fetchPermissions.mockClear();
    fetchDevices.mockReset();
    fetchDevices.mockResolvedValue([]);
  });

  it("runs the setup check on mount", () => {
    render(<App />);
    expect(authState.checkSetupNeeded).toHaveBeenCalled();
  });

  it("shows a loading indicator while auth state is resolving", () => {
    authState.loading = true;
    render(<App />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the setup page on first run (needsSetup)", () => {
    authState.loading = false;
    authState.needsSetup = true;
    render(<App />);
    expect(screen.getByText("setup-page")).toBeInTheDocument();
  });

  it("shows the login page when set up but not authenticated", () => {
    authState.loading = false;
    authState.needsSetup = false;
    authState.isAuthenticated = false;
    render(<App />);
    expect(screen.getByText("login-page")).toBeInTheDocument();
  });

  it("shows the authenticated app (Layout) when logged in", async () => {
    authState.loading = false;
    authState.isAuthenticated = true;
    render(<App />);
    expect(screen.getByTestId("layout")).toBeInTheDocument();
    // Effects in the authenticated tree fire.
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    expect(fetchPermissions).toHaveBeenCalled();
    // Wait for the device fetch to resolve so its .then handler runs.
    await waitFor(() => expect(setDevices).toHaveBeenCalled());
  });

  it("holds the authenticated shell on a loading screen for a non-admin until permissions hydrate", () => {
    authState.loading = false;
    authState.isAuthenticated = true;
    authState.user = { username: "bob", role: "viewer" };
    permState.loaded = false;
    render(<App />);
    expect(screen.getByText("Loading demo workspace…")).toBeInTheDocument();
    expect(screen.queryByTestId("layout")).not.toBeInTheDocument();
  });

  it("tolerates a device fetch failure without crashing the authenticated app", async () => {
    authState.loading = false;
    authState.isAuthenticated = true;
    authState.user = { username: "admin", role: "admin" };
    fetchDevices.mockReset();
    fetchDevices.mockRejectedValue(new Error("offline"));
    render(<App />);
    await waitFor(() => expect(fetchDevices).toHaveBeenCalled());
    // Let the rejected promise settle so the .catch handler executes.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId("layout")).toBeInTheDocument();
    expect(setDevices).not.toHaveBeenCalled();
  });

  it("opens and closes the device detail panel", async () => {
    authState.loading = false;
    authState.isAuthenticated = true;
    authState.user = { username: "admin", role: "admin" };
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("layout")).toBeInTheDocument());
    fireEvent.click(screen.getByText("open-device"));
    expect(screen.getByText("device-dev-1")).toBeInTheDocument();
    // Exercises the onClose handler that clears the selected device.
    fireEvent.click(screen.getByText("close-device"));
    await waitFor(() => expect(screen.queryByText("device-dev-1")).not.toBeInTheDocument());
  });
});
