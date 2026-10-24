// frontend/src/pages/data-store/DataExplorer.test.tsx — the Data page's three concepts
//
// The tabs are the product model: Collections (optional history), Shared Automation
// State (always available) and Storage Settings (history configuration). Several
// tests below exist to stop shared state being re-absorbed into the Data Store
// (ADR-0016).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const demoState = vi.hoisted(() => ({ readOnly: false }));
vi.mock("../../hooks/useReadOnlyDemo", () => ({
  useReadOnlyDemo: () => demoState.readOnly,
}));

const mockFetchStats = vi.fn();
const mockFetchCollections = vi.fn();
const mockFetchSharedStateBuckets = vi.fn();
const mockSelectCollection = vi.fn();

let mockStoreState: Record<string, unknown> = {};

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

vi.mock("./CollectionsTab", () => ({
  CollectionsTab: ({ onConfigure }: { onConfigure: () => void }) => (
    <button data-testid="collections-tab" onClick={onConfigure}>collections</button>
  ),
}));
vi.mock("./SharedStateExplorer", () => ({ SharedStateExplorer: () => <div data-testid="shared-state-explorer" /> }));
vi.mock("./SettingsPanel", () => ({ SettingsPanel: () => <div data-testid="settings-panel" /> }));
vi.mock("./SetupWizard", () => ({ SetupWizard: () => <div data-testid="setup-wizard" /> }));

import { DataExplorer } from "./DataExplorer";

describe("DataExplorer", () => {
  beforeEach(() => {
    demoState.readOnly = false;
    mockFetchStats.mockReset();
    mockFetchCollections.mockReset();
    mockFetchSharedStateBuckets.mockReset();
    mockSelectCollection.mockReset();
    mockStoreState = {
      fetchStats: mockFetchStats,
      fetchCollections: mockFetchCollections,
      fetchSharedStateBuckets: mockFetchSharedStateBuckets,
      selectCollection: mockSelectCollection,
      stats: { totalCollections: 3, totalRecords: 1500, totalBucketEntries: 12, storagePercent: 42, estimatedStorageMb: 21.3, maxStorageMb: 50 },
      selectedCollection: null,
      enabled: true,
    };
  });

  it("renders the Data header", () => {
    render(<DataExplorer />);
    expect(screen.getByRole("heading", { name: "Data" })).toBeInTheDocument();
  });

  it("names both concepts in the page subtitle", () => {
    render(<DataExplorer />);
    expect(
      screen.getByText(/The history your automations record, and the current values they share/i),
    ).toBeInTheDocument();
  });

  it("explains the read-only seeded data in the public demo", () => {
    demoState.readOnly = true;
    render(<DataExplorer />);
    expect(screen.getByText(/Public demo · read only/i)).toBeInTheDocument();
    expect(screen.getByText(/historical measurements and shared current values/i)).toBeInTheDocument();
  });

  it("fetches stats, collections, and Shared State buckets on mount", () => {
    render(<DataExplorer />);
    expect(mockFetchStats).toHaveBeenCalled();
    expect(mockFetchCollections).toHaveBeenCalled();
    expect(mockFetchSharedStateBuckets).toHaveBeenCalled();
  });

  it("displays stats in the summary bar", () => {
    render(<DataExplorer />);
    expect(screen.getByText("3")).toBeInTheDocument(); // collections
    expect(screen.getByText("1,500")).toBeInTheDocument(); // records
    expect(screen.getByText("12")).toBeInTheDocument(); // shared values
    expect(screen.getByText(/21\.3.*50 MB/)).toBeInTheDocument(); // history storage
  });

  it("labels the shared-value count as Shared Values, not Buckets", () => {
    render(<DataExplorer />);
    expect(screen.getByText("Shared Values")).toBeInTheDocument();
    expect(screen.queryByText("Buckets")).not.toBeInTheDocument();
  });

  it("lands on Collections, the view most operators came for", () => {
    render(<DataExplorer />);
    expect(screen.getByTestId("collections-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-state-explorer")).not.toBeInTheDocument();
  });

  it("offers Collections, Shared Automation State and Storage Settings in that order", () => {
    const TABS = ["Collections", "Shared Automation State", "Storage Settings"];
    render(<DataExplorer />);
    const labels = Array.from(document.querySelectorAll("button"))
      .map((b) => b.textContent?.trim())
      .filter((t): t is string => TABS.includes(t ?? ""));
    expect(labels).toEqual(TABS);
  });

  it("names the shared store as automation state, not bare 'Shared State'", () => {
    // "Shared State" never said shared between what. Aeolus already has Automation
    // State — the private per-automation store — so naming this as its sibling is
    // what makes the distinction legible.
    render(<DataExplorer />);
    expect(screen.getByRole("button", { name: /Shared Automation State/ })).toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim()),
    ).not.toContain("Shared State");
  });

  it("clears any stale collection selection on mount so re-entry lands on the home view", () => {
    // The store outlives this route, so a selection left over from a previous
    // visit must not reopen the detail view when the page is mounted again.
    mockStoreState = { ...mockStoreState, selectedCollection: "tank-levels" };
    render(<DataExplorer />);
    expect(mockSelectCollection).toHaveBeenCalledWith(null);
  });

  it("switches to the Shared Automation State tab", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Shared Automation State/ }));
    expect(screen.getByTestId("shared-state-explorer")).toBeInTheDocument();
    expect(screen.queryByTestId("collections-tab")).not.toBeInTheDocument();
  });

  it("shows the live storage settings on the Storage Settings tab when history is enabled", () => {
    render(<DataExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Storage Settings/ }));
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
  });

  describe("when historical Collections are disabled", () => {
    beforeEach(() => {
      mockStoreState = { ...mockStoreState, enabled: false };
    });

    it("keeps Shared Automation State browseable", () => {
      // The whole point of the split: no storage configuration stands between an
      // operator and the shared values their automations are coordinating through.
      // Reachable in one click even though history is off.
      render(<DataExplorer />);
      fireEvent.click(screen.getByRole("button", { name: /Shared Automation State/ }));
      expect(screen.getByTestId("shared-state-explorer")).toBeInTheDocument();
      expect(screen.queryByTestId("setup-wizard")).not.toBeInTheDocument();
    });

    it("shows the setup flow on the Storage Settings tab rather than in front of the page", () => {
      render(<DataExplorer />);
      fireEvent.click(screen.getByRole("button", { name: /Storage Settings/ }));
      expect(screen.getByTestId("setup-wizard")).toBeInTheDocument();
      expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument();
    });

    it("marks the Collections tab as switched off rather than broken", () => {
      render(<DataExplorer />);
      const dot = screen.getByTitle("Historical Collections are not enabled");
      expect(dot).toBeInTheDocument();
    });

    it("says it is not recording history instead of showing a misleading zero bar", () => {
      render(<DataExplorer />);
      expect(screen.getByText("Not recording history")).toBeInTheDocument();
    });

    it("lets the Collections tab send the operator to Storage Settings to configure it", () => {
      // Collections is the landing tab, so no navigation is needed to get here.
      render(<DataExplorer />);
      // The stub calls the onConfigure prop when clicked.
      fireEvent.click(screen.getByTestId("collections-tab"));
      expect(screen.getByTestId("setup-wizard")).toBeInTheDocument();
    });
  });

  it("shows warning styling when storage >= 80%", () => {
    mockStoreState = {
      ...mockStoreState,
      stats: { ...mockStoreState.stats as object, storagePercent: 85 },
    };
    const { container } = render(<DataExplorer />);
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
