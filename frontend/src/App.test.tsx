// frontend/src/App.test.tsx — Auth-guard routing: loading / setup / login / authenticated

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// --- Auth store: a controllable state object the selector reads from ---
const authState: {
  loading: boolean;
  needsSetup: boolean;
  isAuthenticated: boolean;
  checkSetupNeeded: ReturnType<typeof vi.fn>;
} = {
  loading: true,
  needsSetup: false,
  isAuthenticated: false,
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
vi.mock("./components/CommandPalette", () => ({ CommandPalette: () => null }));
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
vi.mock("./store/permissions-store", () => ({
  usePermissionsStore: (selector: (s: { fetchPermissions: typeof fetchPermissions; loaded: boolean }) => unknown) =>
    selector({ fetchPermissions, loaded: true }),
}));

vi.mock("./lib/ws-client", () => ({ connectWebSocket: vi.fn(), disconnectWebSocket: vi.fn() }));
vi.mock("./lib/api-client", () => ({ fetchDevices: vi.fn().mockResolvedValue([]) }));

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
    authState.checkSetupNeeded.mockReset();
    setDevices.mockClear();
    initialize.mockClear();
    fetchPermissions.mockClear();
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
  });
});
