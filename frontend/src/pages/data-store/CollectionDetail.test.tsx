// frontend/src/pages/data-store/CollectionDetail.test.tsx — detail view: header actions, edit, delete

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockState, mockAuthFetch } = vi.hoisted(() => ({
  mockState: {} as any,
  mockAuthFetch: vi.fn(),
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("../../lib/auth-fetch", () => ({
  authFetch: mockAuthFetch,
}));

import { CollectionDetail } from "./CollectionDetail";

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

function resetState() {
  Object.assign(mockState, {
    selectedCollection: "energy-daily",
    collections: [makeCollection()],
    selectCollection: vi.fn(),
    fetchCollections: vi.fn().mockResolvedValue(undefined),
    fetchRecords: vi.fn().mockResolvedValue(undefined),
    records: [],
    recordsTotal: 0,
    recordsLoading: false,
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

  it("navigates back by clearing the selected collection", () => {
    render(<CollectionDetail />);
    // Back button is the first button in the header (ArrowLeft icon).
    fireEvent.click(screen.getAllByRole("button")[0]);
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
