// frontend/src/components/panes/MetricsPane.test.tsx — metrics cards, loading, error states

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { metricsState, startPolling, stopPolling } = vi.hoisted(() => ({
  metricsState: {} as any,
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
}));

// MetricsPane consumes the whole store (no selector).
vi.mock("../../store/metrics-store", () => ({
  useMetricsStore: () => metricsState,
}));

import { MetricsPane } from "./MetricsPane";

function makeSummary(overrides: Record<string, any> = {}) {
  return {
    mqtt: { messagesReceivedRate: 12.3, messagesPublishedRate: 4.5, connected: true },
    devices: { registeredCount: 7 },
    automations: { executionRate: 0.42, activeRules: 3, errorRate: 0 },
    websocket: { activeConnections: 2 },
    system: { uptimeSeconds: 90_061, memoryUsageMb: 128.4, eventLoopLagMs: 1 },
    ...overrides,
  };
}

function renderPane() {
  render(<MetricsPane config={{} as PaneConfig} />);
}

describe("MetricsPane", () => {
  beforeEach(() => {
    Object.assign(metricsState, {
      summary: null,
      loading: false,
      error: null,
      startPolling,
      stopPolling,
    });
    startPolling.mockClear();
    stopPolling.mockClear();
  });

  it("starts polling on mount", () => {
    metricsState.summary = makeSummary();
    renderPane();
    expect(startPolling).toHaveBeenCalled();
  });

  it("shows skeleton cards while loading with no data", () => {
    metricsState.loading = true;
    metricsState.summary = null;
    renderPane();
    // The skeleton grid uses animate-pulse cards.
    expect(document.querySelectorAll(".animate-pulse").length).toBe(9);
  });

  it("shows an error message when the fetch fails with no data", () => {
    metricsState.error = "boom";
    metricsState.summary = null;
    renderPane();
    expect(screen.getByText("Failed to load metrics")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders metric cards from the summary", () => {
    metricsState.summary = makeSummary();
    renderPane();
    expect(screen.getByText("MQTT Messages/sec")).toBeInTheDocument();
    expect(screen.getByText("12.3")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("MQTT Connected")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("formats uptime into days/hours/minutes", () => {
    metricsState.summary = makeSummary({
      system: { uptimeSeconds: 90_061, memoryUsageMb: 64, eventLoopLagMs: 1 },
    });
    renderPane();
    // 90061s = 1d 1h 1m
    expect(screen.getByText("1d 1h 1m")).toBeInTheDocument();
    expect(screen.getByText("64.0 MB")).toBeInTheDocument();
  });

  it("renders nothing when there is no summary and not loading/error", () => {
    metricsState.summary = null;
    const { container } = render(<MetricsPane config={{} as PaneConfig} />);
    expect(container).toBeEmptyDOMElement();
  });
});
