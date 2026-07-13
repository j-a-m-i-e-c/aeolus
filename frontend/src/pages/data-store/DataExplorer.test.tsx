// frontend/src/pages/data-store/DataExplorer.test.tsx — summary bar, tab switching, storage warnings

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

import { DataExplorer } from "./DataExplorer";

function resetState() {
  Object.assign(mockState, {
    // DataExplorer
    fetchStats: vi.fn(),
    fetchCollections: vi.fn(),
    fetchBuckets: vi.fn(),
    stats: {
      totalRecords: 4200,
      totalBucketEntries: 8,
      totalCollections: 3,
      estimatedStorageMb: 120.5,
      maxStorageMb: 500,
      storagePercent: 24,
    },
    selectedCollection: null,
    // CollectionList
    collections: [],
    selectCollection: vi.fn(),
    // BucketList
    buckets: [],
    fetchBucketEntries: vi.fn(),
    bucketEntries: [],
    selectedBucket: null,
    selectBucket: vi.fn(),
    // SettingsPanel
    config: {
      enabled: true,
      maxStorageMb: 500,
      maxRecordsPerCollection: 100000,
      maxCollections: 50,
    },
    fetchConfig: vi.fn(),
  });
}

describe("DataExplorer", () => {
  beforeEach(() => {
    resetState();
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("fetches stats, collections, and buckets on mount", () => {
    render(<DataExplorer />);
    expect(mockState.fetchStats).toHaveBeenCalledTimes(1);
    expect(mockState.fetchCollections).toHaveBeenCalledTimes(1);
    expect(mockState.fetchBuckets).toHaveBeenCalledTimes(1);
  });

  it("renders the summary bar from stats", () => {
    render(<DataExplorer />);
    expect(screen.getByRole("heading", { name: "Data Store" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // total collections
    expect(screen.getByText("4,200")).toBeInTheDocument(); // total records
    expect(screen.getByText("8")).toBeInTheDocument(); // bucket entries
    expect(screen.getByText(/120\.5 \/ 500 MB/)).toBeInTheDocument();
  });

  it("shows the collections tab (empty state) by default", () => {
    render(<DataExplorer />);
    expect(screen.getByText(/No collections yet\./i)).toBeInTheDocument();
  });

  it("switches to the Buckets tab", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Buckets/i }));
    expect(screen.getByText(/No buckets yet\./i)).toBeInTheDocument();
  });

  it("switches to the Settings tab", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));
    expect(screen.getByText("Storage Configuration")).toBeInTheDocument();
  });

  it("renders a critical storage indicator when usage is high", () => {
    mockState.stats = {
      ...mockState.stats,
      estimatedStorageMb: 490,
      storagePercent: 98,
    };
    render(<DataExplorer />);
    expect(screen.getByText(/490\.0 \/ 500 MB/)).toBeInTheDocument();
  });
});
