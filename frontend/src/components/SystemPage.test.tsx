// frontend/src/components/SystemPage.test.tsx — Host diagnostics page render + error paths

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { HealthStatus } from "../store/device-store";

const { mockState, mockFetchHealth, mockAuthFetch } = vi.hoisted(() => ({
  mockState: { health: null as HealthStatus | null, setHealth: vi.fn() },
  mockFetchHealth: vi.fn(),
  mockAuthFetch: vi.fn(),
}));

vi.mock("../store/device-store", () => ({
  useDeviceStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock("../lib/api-client", () => ({
  fetchHealth: mockFetchHealth,
}));

vi.mock("../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { SystemPage } from "./SystemPage";
import { useAuthStore } from "../store/auth-store";

const SYSTEM_INFO = {
  hostname: "aeolus-host",
  platform: "linux",
  arch: "x64",
  nodeVersion: "v22.0.0",
  cpuModel: "Test CPU",
  cpuCores: 4,
  cpuTemp: 45,
  loadAvg: { "1m": 0.5, "5m": 0.4, "15m": 0.3 },
  memory: { total: 100, used: 40, free: 60, usagePercent: 40 },
  disk: { total: 200, used: 50, free: 150, usagePercent: 25 },
  network: [{ name: "eth0", address: "192.168.1.10" }],
  uptime: 90000,
};

const VERSION_INFO = {
  commit: "abc1234",
  buildDate: "unknown",
  updateAvailable: false,
  latestCommit: null,
  commitsBehind: 0,
};

function jsonResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => data });
}

describe("SystemPage", () => {
  beforeEach(() => {
    mockState.health = null;
    mockState.setHealth.mockReset();
    mockFetchHealth.mockReset();
    mockFetchHealth.mockResolvedValue({
      mqtt: "connected",
      deviceCount: 2,
      ruleCount: 1,
      uptime: 60,
      timestamp: "t",
    });
    mockAuthFetch.mockReset();
    // Host diagnostics + logs are admin-only; default the viewer to an admin so
    // the diagnostics-path tests exercise the full render.
    useAuthStore.setState({
      user: { id: "a", username: "admin", role: "admin", groupId: null },
    });
  });

  function routeAuthFetch(systemResponse = () => jsonResponse(SYSTEM_INFO)) {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/api/system/version")) return jsonResponse(VERSION_INFO);
      if (url.includes("/api/system/logs")) return jsonResponse([]);
      if (url.includes("/api/system")) return systemResponse();
      return jsonResponse({});
    });
  }

  it("renders host information once the system data loads", async () => {
    routeAuthFetch();
    render(<SystemPage />);
    expect(await screen.findByText("aeolus-host")).toBeInTheDocument();
    expect(screen.getByText("v22.0.0")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.10")).toBeInTheDocument();
  });

  it("shows the error state when the system request fails", async () => {
    routeAuthFetch(() => jsonResponse({}, false, 500));
    render(<SystemPage />);
    expect(await screen.findByText("System Information Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the health summary when health data is present", async () => {
    mockState.health = {
      mqtt: "connected",
      deviceCount: 7,
      ruleCount: 4,
      uptime: 3600,
      timestamp: "t",
    };
    routeAuthFetch();
    render(<SystemPage />);
    expect(await screen.findByText("aeolus-host")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    // MQTT status label from health summary
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("polls health on mount", async () => {
    routeAuthFetch();
    render(<SystemPage />);
    await waitFor(() => expect(mockFetchHealth).toHaveBeenCalled());
    await waitFor(() => expect(mockState.setHealth).toHaveBeenCalled());
  });

  it("for a non-admin, shows health but not host diagnostics, and never requests /api/system", async () => {
    useAuthStore.setState({
      user: { id: "u", username: "bob", role: "user", groupId: "g1" },
    });
    mockState.health = {
      mqtt: "connected",
      deviceCount: 7,
      ruleCount: 4,
      uptime: 3600,
      timestamp: "t",
    };
    routeAuthFetch();
    render(<SystemPage />);

    // Health summary renders...
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    // ...but host diagnostics do not, and no error page appears.
    expect(screen.queryByText("aeolus-host")).not.toBeInTheDocument();
    expect(screen.queryByText("System Information Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Application Logs")).not.toBeInTheDocument();

    // The admin-only diagnostics/logs endpoints are never called.
    const calledUrls = mockAuthFetch.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes("/api/system/logs"))).toBe(false);
    expect(calledUrls.some((u) => /\/api\/system(\?|$)/.test(u))).toBe(false);
  });
});
