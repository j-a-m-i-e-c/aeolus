// frontend/src/pages/data-store/CollectionList.test.tsx — collection grid, creation form, and errors

import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { CollectionList } from "./CollectionList";

function makeCollection(overrides: Record<string, unknown> = {}) {
  return {
    name: "energy-daily",
    description: "Daily energy usage",
    retentionDays: 30,
    recordCount: 1200,
    oldestRecord: null,
    newestRecord: Date.now() - 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function resetState() {
  Object.assign(mockState, {
    collections: [],
    selectCollection: vi.fn(),
    fetchCollections: vi.fn().mockResolvedValue(undefined),
  });
}

describe("CollectionList", () => {
  beforeEach(() => {
    resetState();
    mockAuthFetch.mockReset();
  });

  it("shows the empty state when there are no user collections", () => {
    render(<CollectionList />);
    expect(
      screen.getByText(/No collections yet\./i),
    ).toBeInTheDocument();
  });

  it("renders a card per user collection with record count and retention", () => {
    mockState.collections = [makeCollection({ name: "energy-daily", recordCount: 1200, retentionDays: 30 })];
    render(<CollectionList />);
    expect(screen.getByText("energy-daily")).toBeInTheDocument();
    expect(screen.getByText("1,200 records")).toBeInTheDocument();
    expect(screen.getByText("30d retention")).toBeInTheDocument();
  });

  it("selects a collection when its card is clicked", () => {
    mockState.collections = [makeCollection({ name: "energy-daily" })];
    render(<CollectionList />);
    fireEvent.click(screen.getByText("energy-daily"));
    expect(mockState.selectCollection).toHaveBeenCalledWith("energy-daily");
  });

  it("groups system metrics collections under the Observability section", () => {
    mockState.collections = [
      makeCollection({ name: "energy-daily" }),
      makeCollection({ name: "_metrics:live:cpu", recordCount: 5 }),
      makeCollection({ name: "_metrics:history:cpu", recordCount: 100 }),
    ];
    render(<CollectionList />);
    expect(screen.getByText("Observability")).toBeInTheDocument();
    expect(screen.getByText("cpu")).toBeInTheDocument();
    // Combined live + history record counts (5 + 100)
    expect(screen.getByText("105 records")).toBeInTheDocument();
  });

  it("opens the creation form and disables Create until a name is entered", () => {
    render(<CollectionList />);
    fireEvent.click(screen.getByRole("button", { name: /New Collection/i }));
    expect(screen.getByText("Create Collection")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /^Create$/i });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g. energy-daily"), {
      target: { value: "new-col" },
    });
    expect(create).not.toBeDisabled();
  });

  it("submits a new collection and refreshes the list on success", async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<CollectionList />);
    fireEvent.click(screen.getByRole("button", { name: /New Collection/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. energy-daily"), {
      target: { value: "new-col" },
    });
    fireEvent.change(screen.getByPlaceholderText("What this collection stores"), {
      target: { value: "desc" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 30"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));
    const [url, options] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/data-store\/collections$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      name: "new-col",
      description: "desc",
      retentionDays: 7,
    });
    await waitFor(() => expect(mockState.fetchCollections).toHaveBeenCalled());
  });

  it("surfaces the server error message when creation fails", async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "Name already exists" }),
    });
    render(<CollectionList />);
    fireEvent.click(screen.getByRole("button", { name: /New Collection/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. energy-daily"), {
      target: { value: "dup" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));

    expect(await screen.findByText("Name already exists")).toBeInTheDocument();
    expect(mockState.fetchCollections).not.toHaveBeenCalled();
  });
});
