// frontend/src/pages/data-store/CollectionsTab.test.tsx — the historical Collections gate
//
// The enable step lives here rather than in front of the whole Data page, so that
// Shared State stays reachable on an install that records no history (ADR-0016).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockState } = vi.hoisted(() => ({
  mockState: {} as any,
}));

vi.mock("../../store/data-store-store", () => ({
  useDataStoreStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("./CollectionList", () => ({ CollectionList: () => <div data-testid="collection-list" /> }));
vi.mock("./CollectionDetail", () => ({ CollectionDetail: () => <div data-testid="collection-detail" /> }));

import { CollectionsTab } from "./CollectionsTab";

describe("CollectionsTab", () => {
  beforeEach(() => {
    Object.assign(mockState, { enabled: true, selectedCollection: null });
  });

  it("lists collections when history is enabled", () => {
    render(<CollectionsTab onConfigure={vi.fn()} />);
    expect(screen.getByTestId("collection-list")).toBeInTheDocument();
  });

  it("shows the detail view when a collection is selected", () => {
    mockState.selectedCollection = "temps";
    render(<CollectionsTab onConfigure={vi.fn()} />);
    expect(screen.getByTestId("collection-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-list")).not.toBeInTheDocument();
  });

  describe("when history is disabled", () => {
    beforeEach(() => {
      mockState.enabled = false;
    });

    it("explains why history is opt-in rather than showing an empty list", () => {
      render(<CollectionsTab onConfigure={vi.fn()} />);
      expect(screen.getByText("Historical Collections are not enabled")).toBeInTheDocument();
      expect(screen.getByText(/accumulates without bound/i)).toBeInTheDocument();
      expect(screen.queryByTestId("collection-list")).not.toBeInTheDocument();
    });

    it("says Shared State is unaffected, so the page does not read as broken", () => {
      render(<CollectionsTab onConfigure={vi.fn()} />);
      expect(screen.getByText(/Shared State needs none of that and is\s+available now/i)).toBeInTheDocument();
    });

    it("offers a route to the storage configuration", () => {
      const onConfigure = vi.fn();
      render(<CollectionsTab onConfigure={onConfigure} />);
      fireEvent.click(screen.getByRole("button", { name: /Set up historical storage/i }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
    });
  });
});
