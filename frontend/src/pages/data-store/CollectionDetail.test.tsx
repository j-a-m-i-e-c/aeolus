// frontend/src/pages/data-store/CollectionDetail.test.tsx — detail view: header actions, edit, delete

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockState, mockAuthFetch } = vi.hoisted(() => ({
  mockState: {} as any,
  mockAuthFetch: vi.fn(),
}));

// The real module is kept for its query-bound constants; only the hook is faked,
// so the test asserts against the same bounds the component uses.
vi.mock("../../store/data-store-store", async () => {
  const actual =
    await vi.importActual<typeof import("../../store/data-store-store")>(
      "../../store/data-store-store",
    );
  return {
    ...actual,
    useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
  };
});

vi.mock("../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { CollectionDetail } from "./CollectionDetail";
import { CHART_MAX_POINTS } from "../../store/data-store-store";

// jsdom lacks ResizeObserver, which TimeSeriesChart relies on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeCollection(overrides: Record<string, unknown> = {}) {
  return {
    name: "energy-daily",
    description: "Daily energy usage",
    retentionDays: 30,
    recordCount: 1200,
    oldestRecord: null,
    newestRecord: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function record(id: number, payload: Record<string, unknown>, timestamp = id) {
  return { id, collection: "energy-daily", payload, tags: {}, timestamp };
}

function resetState() {
  Object.assign(mockState, {
    selectedCollection: "energy-daily",
    collections: [makeCollection()],
    selectCollection: vi.fn(),
    fetchCollections: vi.fn().mockResolvedValue(undefined),
    fetchRecords: vi.fn().mockResolvedValue(undefined),
    fetchChartRecords: vi.fn().mockResolvedValue(undefined),
    records: [],
    recordsTotal: 0,
    recordsLoading: false,
    recordsPage: 0,
    setRecordsPage: vi.fn(),
    chartRecords: [],
    chartTotal: 0,
    chartLoading: false,
    timeRange: "24h",
    setTimeRange: vi.fn(),
  });
}

describe("CollectionDetail", () => {
  beforeEach(() => {
    (globalThis as any).ResizeObserver = ResizeObserverStub;
    resetState();
    mockAuthFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when no collection is selected", () => {
    mockState.selectedCollection = null;
    const { container } = render(<CollectionDetail />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the collection name, description, and fetches records", () => {
    render(<CollectionDetail />);
    expect(screen.getByText("energy-daily")).toBeInTheDocument();
    expect(screen.getByText("Daily energy usage")).toBeInTheDocument();
    expect(mockState.fetchRecords).toHaveBeenCalledWith("energy-daily", {
      from: "24h",
      limit: 50,
      offset: 0,
    });
  });

  it("queries the chart over the whole range, not the table's page", () => {
    render(<CollectionDetail />);
    expect(mockState.fetchChartRecords).toHaveBeenCalledWith("energy-daily", {
      from: "24h",
      limit: CHART_MAX_POINTS,
    });
    // An offset would tie the graph to a table page — the bug this separation fixes.
    expect(mockState.fetchChartRecords.mock.calls[0][1]).not.toHaveProperty("offset");
  });

  it("does not re-query the chart when the table changes page", () => {
    const { rerender } = render(<CollectionDetail />);
    expect(mockState.fetchChartRecords).toHaveBeenCalledTimes(1);
    expect(mockState.fetchRecords).toHaveBeenCalledTimes(1);

    mockState.recordsPage = 2;
    rerender(<CollectionDetail />);

    // The table advances to the next window; the graph's dataset is untouched.
    expect(mockState.fetchRecords).toHaveBeenCalledTimes(2);
    expect(mockState.fetchRecords).toHaveBeenLastCalledWith("energy-daily", {
      from: "24h",
      limit: 50,
      offset: 100,
    });
    expect(mockState.fetchChartRecords).toHaveBeenCalledTimes(1);
  });

  it("re-queries both datasets when the time range changes", () => {
    const { rerender } = render(<CollectionDetail />);
    mockState.timeRange = "30d";
    rerender(<CollectionDetail />);

    expect(mockState.fetchChartRecords).toHaveBeenLastCalledWith("energy-daily", {
      from: "30d",
      limit: CHART_MAX_POINTS,
    });
    expect(mockState.fetchRecords).toHaveBeenLastCalledWith("energy-daily", {
      from: "30d",
      limit: 50,
      offset: 0,
    });
  });

  it("charts the chart dataset rather than the table page", () => {
    // Distinct datasets: only the chart's records may reach the graph.
    mockState.records = [record(1, { fromTable: 5 })];
    mockState.chartRecords = [
      record(2, { fromChart: 10 }),
      record(3, { fromChart: 12 }),
    ];
    mockState.chartTotal = 8421;

    render(<CollectionDetail />);

    expect(screen.getByRole("button", { name: /fromChart/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fromTable/i })).not.toBeInTheDocument();
  });

  it("states how much of the range the chart is drawing", () => {
    mockState.chartRecords = [record(2, { header: 10 }), record(3, { header: 12 })];
    mockState.chartTotal = 8421;
    render(<CollectionDetail />);
    expect(
      screen.getByText("Showing 2 of 8,421 observations over 24 hours"),
    ).toBeInTheDocument();
  });

  it("navigates back via a labelled control that clears the selected collection", () => {
    render(<CollectionDetail />);
    fireEvent.click(screen.getByRole("button", { name: /All collections/i }));
    expect(mockState.selectCollection).toHaveBeenCalledWith(null);
  });

  it("opens a new tab for CSV export", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<CollectionDetail />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toMatch(
      /\/api\/data-store\/collections\/energy-daily\/export$/,
    );
  });

  it("toggles the edit panel and saves changes via PATCH", async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<CollectionDetail />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByText("Edit Collection")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));
    const [url, options] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/data-store\/collections\/energy-daily$/);
    expect(options.method).toBe("PATCH");
    await waitFor(() => expect(mockState.fetchCollections).toHaveBeenCalled());
  });

  it("confirms and deletes the collection via DELETE", async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<CollectionDetail />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    expect(
      screen.getByText(/Are you sure you want to delete/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Delete Forever/i }));
    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));
    const [url, options] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/data-store\/collections\/energy-daily$/);
    expect(options.method).toBe("DELETE");
    await waitFor(() =>
      expect(mockState.selectCollection).toHaveBeenCalledWith(null),
    );
  });

  it("dismisses the delete confirmation on Cancel", () => {
    render(<CollectionDetail />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(
      screen.queryByText(/Are you sure you want to delete/i),
    ).not.toBeInTheDocument();
  });
});
