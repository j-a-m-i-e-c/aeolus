// frontend/src/pages/DataStorePage.test.tsx — top-level routing: loading / wizard / explorer

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockState } = vi.hoisted(() => ({
  mockState: {} as any,
}));

vi.mock("../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("./data-store/SetupWizard", () => ({
  SetupWizard: () => <div>setup-wizard-stub</div>,
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
    expect(screen.getByText("Loading Data Store…")).toBeInTheDocument();
  });

  it("renders the setup wizard when config is loaded but disabled", () => {
    mockState.config = { enabled: false, maxStorageMb: 0, maxRecordsPerCollection: 0, maxCollections: 0 };
    mockState.enabled = false;
    render(<DataStorePage />);
    expect(screen.getByText("setup-wizard-stub")).toBeInTheDocument();
  });

  it("renders the data explorer when the store is enabled", () => {
    mockState.config = { enabled: true, maxStorageMb: 500, maxRecordsPerCollection: 100000, maxCollections: 50 };
    mockState.enabled = true;
    render(<DataStorePage />);
    expect(screen.getByText("data-explorer-stub")).toBeInTheDocument();
  });
});
