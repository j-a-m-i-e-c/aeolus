// frontend/src/components/panes/ScheduleViewerPane.test.tsx — Cron schedule viewer

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

import { ScheduleViewerPane } from "./ScheduleViewerPane";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const AUTOMATIONS = [
  { id: "a1", name: "Hourly Report", triggerType: "cron", cronExpression: "0 * * * *", enabled: true },
  { id: "a2", name: "Nightly Backup", triggerType: "cron", cronExpression: "0 2 * * *", enabled: false },
  { id: "a3", name: "MQTT Rule", triggerType: "mqtt", cronExpression: null, enabled: true },
];

describe("ScheduleViewerPane", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it("shows loading state initially", () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    expect(screen.getByText("Loading schedules…")).toBeInTheDocument();
  });

  it("renders only cron-triggered automations after fetch", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/api/automations/history")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(AUTOMATIONS));
    });
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    expect(await screen.findByText("Hourly Report")).toBeInTheDocument();
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument();
    // MQTT rule should be filtered out
    expect(screen.queryByText("MQTT Rule")).not.toBeInTheDocument();
  });

  it("shows empty state when no cron automations exist", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([{ id: "a3", name: "MQTT Rule", triggerType: "mqtt", enabled: true }]));
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    expect(await screen.findByText("No scheduled automations.")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    mockAuthFetch.mockRejectedValue(new Error("Network down"));
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    expect(await screen.findByText("Network down")).toBeInTheDocument();
  });

  it("filters by search text", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/history")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(AUTOMATIONS));
    });
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    await screen.findByText("Hourly Report");
    fireEvent.change(screen.getByPlaceholderText("Search by name…"), { target: { value: "Nightly" } });
    expect(screen.queryByText("Hourly Report")).not.toBeInTheDocument();
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument();
  });

  it("filters by enabled/disabled pills", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/history")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(AUTOMATIONS));
    });
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    await screen.findByText("Hourly Report");
    fireEvent.click(screen.getByText("disabled"));
    expect(screen.queryByText("Hourly Report")).not.toBeInTheDocument();
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument();
  });

  it("does not expose generic Fire Now controls", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/history")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(AUTOMATIONS));
    });
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    await screen.findByText("Hourly Report");
    expect(screen.queryByText("Fire Now")).not.toBeInTheDocument();
  });

  it("toggles an automation via PATCH", async () => {
    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes("/history")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse(AUTOMATIONS));
    });
    render(<ScheduleViewerPane config={{} as PaneConfig} />);
    await screen.findByText("Hourly Report");
    // First "Disable" button corresponds to "Hourly Report" (enabled)
    fireEvent.click(screen.getAllByText("Disable")[0]);
    await waitFor(() =>
      expect(mockAuthFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/automations/a1/toggle"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });
});
