// frontend/src/components/panes/MetricsChartsPane.test.tsx — data-store gating, loading, error, charts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

const { historyState, dataStoreState, startPolling, stopPolling, setTimeRange, fetchConfig } =
  vi.hoisted(() => ({
    historyState: {} as any,
    dataStoreState: {} as any,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    setTimeRange: vi.fn(),
    fetchConfig: vi.fn(),
  }));

// Whole-store consumption (no selector).
vi.mock("../../store/metrics-history-store", () => ({
  useMetricsHistoryStore: () => historyState,
}));

// Selector-based consumption.
vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(dataStoreState),
}));

// Isolate charts + time range widget.
vi.mock("../TimeRangeSelector", () => ({
  TimeRangeSelector: () => <div data-testid="time-range" />,
}));
vi.mock("../MetricSparkline", () => ({
  MetricSparkline: ({ label }: { label: string }) => (
    <div data-testid="sparkline">{label}</div>
  ),
}));

import { MetricsChartsPane } from "./MetricsChartsPane";

function renderPane() {
  render(<MetricsChartsPane config={{} as PaneConfig} />);
}

describe("MetricsChartsPane", () => {
  beforeEach(() => {
    Object.assign(historyState, {
      timeRange: "1h",
      chartData: {},
      loading: false,
      error: null,
      setTimeRange,
      startPolling,
      stopPolling,
    });
    Object.assign(dataStoreState, { enabled: true, fetchConfig });
    startPolling.mockClear();
    stopPolling.mockClear();
    fetchConfig.mockClear();
  });

  it("shows the disabled prompt when the data store is off", () => {
    dataStoreState.enabled = false;
    renderPane();
    expect(screen.getByText("Metrics history requires Data Store")).toBeInTheDocument();
    expect(fetchConfig).toHaveBeenCalled();
  });

  it("shows the skeleton loading grid on the initial fetch", () => {
    historyState.loading = true;
    historyState.chartData = {};
    renderPane();
    expect(screen.getByText("Metrics History")).toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(startPolling).toHaveBeenCalled();
  });

  it("shows an error state when the fetch fails with no data", () => {
    historyState.error = "history down";
    historyState.chartData = {};
    renderPane();
    expect(screen.getByText("Failed to load metrics history")).toBeInTheDocument();
    expect(screen.getByText("history down")).toBeInTheDocument();
  });

  it("renders one sparkline per chart definition when data is present", () => {
    historyState.chartData = {
      mqttMessageRate: { points: [{ timestamp: 1, value: 2 }], currentValue: 2 },
    };
    renderPane();
    const charts = screen.getAllByTestId("sparkline");
    expect(charts).toHaveLength(5);
    expect(screen.getByText("MQTT Message Rate")).toBeInTheDocument();
    expect(screen.getByText("Memory Usage")).toBeInTheDocument();
  });
});
