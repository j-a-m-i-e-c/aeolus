import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { DataRecord } from "../../store/data-store-store";

const { dataStoreState } = vi.hoisted(() => ({
  dataStoreState: { latestRecordByCollection: {} as Record<string, DataRecord> },
}));

// The pane reads only latestRecordByCollection from the store via a selector.
vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: unknown) => unknown) => selector(dataStoreState),
}));

vi.mock("../../lib/env", () => ({ API_URL: "http://test" }));

const authFetchMock = vi.fn();
vi.mock("../../lib/auth-fetch", () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { DataCollectionPane } from "./DataCollectionPane";

function mockRecords(records: DataRecord[]) {
  authFetchMock.mockResolvedValue({ json: async () => ({ records, total: records.length }) });
}

function record(id: number, payload: Record<string, unknown>): DataRecord {
  return { id, collection: "temps", payload, tags: {}, timestamp: 1_700_000_000_000 + id };
}

describe("DataCollectionPane", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    dataStoreState.latestRecordByCollection = {};
  });

  afterEach(() => vi.clearAllMocks());

  it("shows a prompt when no collection is configured", () => {
    render(<DataCollectionPane config={{}} />);
    expect(screen.getByText(/Configure a collection/i)).toBeInTheDocument();
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it("fetches and renders the configured collection's records", async () => {
    mockRecords([record(1, { temp: 21 }), record(2, { temp: 22 })]);
    render(<DataCollectionPane config={{ collection: "temps" }} />);

    await waitFor(() => expect(screen.getByText(/"temp":21/)).toBeInTheDocument());
    expect(screen.getByText(/"temp":22/)).toBeInTheDocument();
    expect(authFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/data-store/collections/temps/records"),
    );
  });

  it("shows an empty state when the collection has no records", async () => {
    mockRecords([]);
    render(<DataCollectionPane config={{ collection: "temps" }} />);
    await waitFor(() => expect(screen.getByText("No records yet.")).toBeInTheDocument());
  });

  it("appends a live record for its collection", async () => {
    mockRecords([record(1, { temp: 21 })]);
    const { rerender } = render(<DataCollectionPane config={{ collection: "temps" }} />);
    await waitFor(() => expect(screen.getByText(/"temp":21/)).toBeInTheDocument());

    // Simulate a realtime record arriving for this collection.
    act(() => {
      dataStoreState.latestRecordByCollection = { temps: record(2, { temp: 23 }) };
    });
    rerender(<DataCollectionPane config={{ collection: "temps" }} />);

    await waitFor(() => expect(screen.getByText(/"temp":23/)).toBeInTheDocument());
  });
});
