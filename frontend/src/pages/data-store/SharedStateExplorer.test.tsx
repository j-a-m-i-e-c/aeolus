// frontend/src/pages/data-store/SharedStateExplorer.test.tsx — browsing durable shared values

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockState } = vi.hoisted(() => ({
  mockState: {} as any,
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

import { SharedStateExplorer } from "./SharedStateExplorer";

function resetState() {
  Object.assign(mockState, {
    sharedStateBuckets: [],
    fetchSharedStateBuckets: vi.fn(),
    fetchSharedStateEntries: vi.fn(),
    sharedStateEntries: [],
    selectedSharedStateBucket: null,
    selectSharedStateBucket: vi.fn(),
  });
}

describe("SharedStateExplorer", () => {
  beforeEach(() => {
    resetState();
  });

  it("fetches Shared State buckets on mount", () => {
    render(<SharedStateExplorer />);
    expect(mockState.fetchSharedStateBuckets).toHaveBeenCalledTimes(1);
  });

  it("explains that Shared State holds the latest value, not a history", () => {
    // The distinction ADR-0016 exists to make. Without it the view reads as a
    // second kind of storage rather than a different kind of fact.
    render(<SharedStateExplorer />);
    expect(screen.getByText(/latest value only — it is not a history/i)).toBeInTheDocument();
    expect(screen.getByText(/survive restarts/i)).toBeInTheDocument();
  });

  it("points the empty state at shared.set(), not db.set()", () => {
    render(<SharedStateExplorer />);
    expect(screen.getByText(/No shared values yet\./i)).toBeInTheDocument();
    expect(screen.getByText("shared.set()")).toBeInTheDocument();
    expect(screen.queryByText("db.set()")).not.toBeInTheDocument();
  });

  it("lists buckets with singular/plural value counts", () => {
    mockState.sharedStateBuckets = [
      { bucket: "bunker-summary", keyCount: 3 },
      { bucket: "config", keyCount: 1 },
    ];
    render(<SharedStateExplorer />);
    expect(screen.getByText("bunker-summary")).toBeInTheDocument();
    expect(screen.getByText("config")).toBeInTheDocument();
    // "values", not "keys" — the user-facing noun is the shared value.
    expect(screen.getByText("3 values")).toBeInTheDocument();
    expect(screen.getByText("1 value")).toBeInTheDocument();
  });

  it("describes the showcase summary buckets so a visitor can follow the composition", () => {
    mockState.sharedStateBuckets = [{ bucket: "bunker-summary", keyCount: 4 }];
    render(<SharedStateExplorer />);
    expect(screen.getByText(/Bunker Overview is triggered by changes here/i)).toBeInTheDocument();
  });

  it("expands a bucket on click, selecting it and fetching its values", () => {
    mockState.sharedStateBuckets = [{ bucket: "sensors", keyCount: 2 }];
    mockState.selectedSharedStateBucket = "sensors";
    mockState.sharedStateEntries = [
      { key: "temp", value: 23, updatedAt: Date.UTC(2024, 0, 1, 12, 0, 0) },
      { key: "meta", value: { nested: true }, updatedAt: Date.UTC(2024, 0, 1, 12, 0, 0) },
    ];
    render(<SharedStateExplorer />);

    fireEvent.click(screen.getByText("sensors"));

    expect(mockState.selectSharedStateBucket).toHaveBeenCalledWith("sensors");
    expect(mockState.fetchSharedStateEntries).toHaveBeenCalledWith("sensors");
    expect(screen.getByText("temp")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText('{"nested":true}')).toBeInTheDocument();
  });

  it("shows each value's canonical reactive path", () => {
    // `<bucket>/<key>` is exactly what a shared-state trigger pattern matches, so
    // showing it here is how an author learns what to type into the trigger.
    mockState.sharedStateBuckets = [{ bucket: "bunker-summary", keyCount: 1 }];
    mockState.selectedSharedStateBucket = "bunker-summary";
    mockState.sharedStateEntries = [{ key: "power", value: 1, updatedAt: 0 }];
    render(<SharedStateExplorer />);

    fireEvent.click(screen.getByText("bunker-summary"));
    expect(screen.getByText("bunker-summary/")).toBeInTheDocument();
    expect(screen.getByText("power")).toBeInTheDocument();
  });

  it("renders a stored null as null rather than crashing", () => {
    mockState.sharedStateBuckets = [{ bucket: "sensors", keyCount: 1 }];
    mockState.selectedSharedStateBucket = "sensors";
    mockState.sharedStateEntries = [{ key: "maybe", value: null, updatedAt: 0 }];
    render(<SharedStateExplorer />);

    fireEvent.click(screen.getByText("sensors"));
    expect(screen.getByText("null")).toBeInTheDocument();
  });

  it("shows 'No values' when an expanded bucket has none", () => {
    mockState.sharedStateBuckets = [{ bucket: "empty", keyCount: 0 }];
    mockState.selectedSharedStateBucket = "empty";
    mockState.sharedStateEntries = [];
    render(<SharedStateExplorer />);

    fireEvent.click(screen.getByText("empty"));
    expect(screen.getByText("No values")).toBeInTheDocument();
  });

  it("collapses an expanded bucket on a second click, clearing selection", () => {
    mockState.sharedStateBuckets = [{ bucket: "sensors", keyCount: 1 }];
    mockState.selectedSharedStateBucket = "sensors";
    mockState.sharedStateEntries = [];
    render(<SharedStateExplorer />);

    const header = screen.getByText("sensors");
    fireEvent.click(header); // expand
    fireEvent.click(header); // collapse
    expect(mockState.selectSharedStateBucket).toHaveBeenLastCalledWith(null);
  });
});
