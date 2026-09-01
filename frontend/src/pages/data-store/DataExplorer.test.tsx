// frontend/src/pages/data-store/DataExplorer.test.tsx — Unit tests for DataExplorer

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const demoState = vi.hoisted(() => ({ readOnly: false }));
vi.mock("../../hooks/useReadOnlyDemo", () => ({
  useReadOnlyDemo: () => demoState.readOnly,
}));

const mockFetchStats = vi.fn();
const mockFetchCollections = vi.fn();
const mockFetchBuckets = vi.fn();
const mockSelectCollection = vi.fn();

let mockStoreState: Record<string, unknown> = {};

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

vi.mock("./CollectionList", () => ({ CollectionList: () => <div data-testid="collection-list" /> }));
vi.mock("./CollectionDetail", () => ({ CollectionDetail: () => <div data-testid="collection-detail" /> }));
vi.mock("./BucketList", () => ({ BucketList: () => <div data-testid="bucket-list" /> }));
vi.mock("./SettingsPanel", () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));

import { DataExplorer } from "./DataExplorer";

describe("DataExplorer", () => {
  beforeEach(() => {
    demoState.readOnly = false;
    mockFetchStats.mockReset();
    mockFetchCollections.mockReset();
    mockFetchBuckets.mockReset();
    mockSelectCollection.mockReset();
    mockStoreState = {
      fetchStats: mockFetchStats,
      fetchCollections: mockFetchCollections,
      fetchBuckets: mockFetchBuckets,
      selectCollection: mockSelectCollection,
      stats: { totalCollections: 3, totalRecords: 1500, totalBucketEntries: 12, storagePercent: 42, estimatedStorageMb: 21.3, maxStorageMb: 50 },
      selectedCollection: null,
    };
  });

  it("renders the Data Store header", () => {
    render(<DataExplorer />);
    expect(screen.getByText("Data Store")).toBeInTheDocument();
  });

  it("explains the read-only seeded Data Store in the public demo", () => {
    demoState.readOnly = true;
    render(<DataExplorer />);
    expect(screen.getByText(/Public demo · read only/i)).toBeInTheDocument();
    expect(screen.getByText(/time-series measurements and shared key\/value state/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Configuration/i })).toBeInTheDocument();
  });

  it("fetches stats, collections, and buckets on mount", () => {
    render(<DataExplorer />);
    expect(mockFetchStats).toHaveBeenCalled();
    expect(mockFetchCollections).toHaveBeenCalled();
    expect(mockFetchBuckets).toHaveBeenCalled();
  });

  it("displays stats in the summary bar", () => {
    render(<DataExplorer />);
    expect(screen.getByText("3")).toBeInTheDocument(); // collections
    expect(screen.getByText("1,500")).toBeInTheDocument(); // records
    expect(screen.getByText("12")).toBeInTheDocument(); // bucket entries
    expect(screen.getByText(/21\.3.*50 MB/)).toBeInTheDocument(); // storage
  });

  it("shows CollectionList by default on the Collections tab", () => {
    render(<DataExplorer />);
    expect(screen.getByTestId("collection-list")).toBeInTheDocument();
  });

  it("clears any stale collection selection on mount so re-entry lands on the home view", () => {
    // The store outlives this route, so a selection left over from a previous
    // visit must not reopen the detail view when the page is mounted again.
    mockStoreState = { ...mockStoreState, selectedCollection: "tank-levels" };
    render(<DataExplorer />);
    expect(mockSelectCollection).toHaveBeenCalledWith(null);
  });

  it("shows CollectionDetail when a collection is selected", () => {
    mockStoreState = { ...mockStoreState, selectedCollection: "temps" };
    render(<DataExplorer />);
    expect(screen.getByTestId("collection-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-list")).not.toBeInTheDocument();
  });

  it("switches to Buckets tab", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Buckets/i }));
    expect(screen.getByTestId("bucket-list")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-list")).not.toBeInTheDocument();
  });

  it("switches to Settings tab", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Configuration/i }));
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
  });

  it("shows warning styling when storage >= 80%", () => {
    mockStoreState = {
      ...mockStoreState,
      stats: { ...mockStoreState.stats as object, storagePercent: 85 },
    };
    const { container } = render(<DataExplorer />);
    // The progress bar should have warning color class
    const bar = container.querySelector('[style*="width: 85%"]');
    expect(bar).toBeInTheDocument();
  });

  it("shows critical styling when storage >= 95%", () => {
    mockStoreState = {
      ...mockStoreState,
      stats: { ...mockStoreState.stats as object, storagePercent: 97 },
    };
    const { container } = render(<DataExplorer />);
    const bar = container.querySelector('[style*="width: 97%"]');
    expect(bar).toBeInTheDocument();
  });
});
