// frontend/src/pages/data-store/BucketList.test.tsx — expandable bucket list rendering & interactions

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockState } = vi.hoisted(() => ({
  mockState: {} as any,
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

import { BucketList } from "./BucketList";

function resetState() {
  Object.assign(mockState, {
    buckets: [],
    fetchBuckets: vi.fn(),
    fetchBucketEntries: vi.fn(),
    bucketEntries: [],
    selectedBucket: null,
    selectBucket: vi.fn(),
  });
}

describe("BucketList", () => {
  beforeEach(() => {
    resetState();
  });

  it("fetches buckets on mount", () => {
    render(<BucketList />);
    expect(mockState.fetchBuckets).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no buckets", () => {
    render(<BucketList />);
    expect(
      screen.getByText(/No buckets yet\./i),
    ).toBeInTheDocument();
  });

  it("lists buckets with singular/plural key counts", () => {
    mockState.buckets = [
      { bucket: "sensors", keyCount: 3 },
      { bucket: "config", keyCount: 1 },
    ];
    render(<BucketList />);
    expect(screen.getByText("sensors")).toBeInTheDocument();
    expect(screen.getByText("config")).toBeInTheDocument();
    expect(screen.getByText("3 keys")).toBeInTheDocument();
    expect(screen.getByText("1 key")).toBeInTheDocument();
  });

  it("expands a bucket on click, selecting it and fetching its entries", () => {
    mockState.buckets = [{ bucket: "sensors", keyCount: 2 }];
    mockState.selectedBucket = "sensors";
    mockState.bucketEntries = [
      { key: "temp", value: 23, updatedAt: Date.UTC(2024, 0, 1, 12, 0, 0) },
      { key: "meta", value: { nested: true }, updatedAt: Date.UTC(2024, 0, 1, 12, 0, 0) },
    ];
    render(<BucketList />);

    fireEvent.click(screen.getByText("sensors"));

    expect(mockState.selectBucket).toHaveBeenCalledWith("sensors");
    expect(mockState.fetchBucketEntries).toHaveBeenCalledWith("sensors");
    // Entries render once expanded and selectedBucket matches
    expect(screen.getByText("temp")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText('{"nested":true}')).toBeInTheDocument();
  });

  it("shows 'No entries' when an expanded bucket has none", () => {
    mockState.buckets = [{ bucket: "empty", keyCount: 0 }];
    mockState.selectedBucket = "empty";
    mockState.bucketEntries = [];
    render(<BucketList />);

    fireEvent.click(screen.getByText("empty"));
    expect(screen.getByText("No entries")).toBeInTheDocument();
  });

  it("collapses an expanded bucket on a second click, clearing selection", () => {
    mockState.buckets = [{ bucket: "sensors", keyCount: 1 }];
    mockState.selectedBucket = "sensors";
    mockState.bucketEntries = [];
    render(<BucketList />);

    const header = screen.getByText("sensors");
    fireEvent.click(header); // expand
    fireEvent.click(header); // collapse
    expect(mockState.selectBucket).toHaveBeenLastCalledWith(null);
  });
});
