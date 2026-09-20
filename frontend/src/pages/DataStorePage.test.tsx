// frontend/src/pages/DataStorePage.test.tsx — top-level routing: loading / explorer
//
// The page no longer gates on historical Data Store enablement. Shared State is a
// core facility, so the explorer renders either way and the setup flow lives
// inside the Collections and Storage tabs (ADR-0016).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockState } = vi.hoisted(() => ({
  mockState: {} as any,
}));

vi.mock("../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("./data-store/DataExplorer", () => ({
  DataExplorer: () => <div>data-explorer-stub</div>,
}));

import { DataStorePage } from "./DataStorePage";

function resetState() {
  Object.assign(mockState, {
    fetchConfig: vi.fn(),
    config: null,
    enabled: false,
  });
}

describe("DataStorePage", () => {
  beforeEach(() => {
    resetState();
  });

  it("fetches config on mount", () => {
    render(<DataStorePage />);
    expect(mockState.fetchConfig).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state while config is null", () => {
    render(<DataStorePage />);
    expect(screen.getByText("Loading Data…")).toBeInTheDocument();
  });

  it("renders the explorer when historical Collections are enabled", () => {
    mockState.config = { enabled: true, maxStorageMb: 500, maxRecordsPerCollection: 100000, maxCollections: 50 };
    mockState.enabled = true;
    render(<DataStorePage />);
    expect(screen.getByText("data-explorer-stub")).toBeInTheDocument();
  });

  it("still renders the explorer when historical Collections are disabled", () => {
    // The regression this guards: the page used to replace itself with the setup
    // wizard, which made Shared State unreachable on any install that had not
    // enabled historical storage — despite Shared State needing no storage config.
    mockState.config = { enabled: false, maxStorageMb: 0, maxRecordsPerCollection: 0, maxCollections: 0 };
    mockState.enabled = false;
    render(<DataStorePage />);
    expect(screen.getByText("data-explorer-stub")).toBeInTheDocument();
  });
});
