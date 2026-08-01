// src/websocket/data-store-visibility.test.ts

import { describe, it, expect, vi } from "vitest";
import { createDataStoreVisibility } from "./data-store-visibility.js";
import type { CollectionOwnershipStore } from "../auth/collection-ownership-store.js";

function storeReturning(tabs: string[]): CollectionOwnershipStore {
  return {
    getExposingTabs: vi.fn().mockReturnValue(tabs),
    reconcileAll: vi.fn(),
  };
}

describe("createDataStoreVisibility", () => {
  it("scopes an event to the collection's exposing tabs", () => {
    const store = storeReturning(["tab-a", "tab-b"]);
    const visibility = createDataStoreVisibility(store);

    expect(visibility({ collection: "temps", record: {} })).toEqual({
      visibility: "tabs",
      tabIds: ["tab-a", "tab-b"],
    });
    expect(store.getExposingTabs).toHaveBeenCalledWith("temps");
  });

  it("resolves to a tabs envelope with an empty set (admin-only) for an unsurfaced collection", () => {
    const store = storeReturning([]);
    const visibility = createDataStoreVisibility(store);

    expect(visibility({ collection: "orphan" })).toEqual({ visibility: "tabs", tabIds: [] });
  });

  it("is admin-only when the payload carries no collection name", () => {
    const store = storeReturning(["tab-a"]);
    const visibility = createDataStoreVisibility(store);

    expect(visibility({ record: {} })).toEqual({ visibility: "admin" });
    expect(visibility(null)).toEqual({ visibility: "admin" });
    expect(visibility({ collection: 123 })).toEqual({ visibility: "admin" });
    expect(store.getExposingTabs).not.toHaveBeenCalled();
  });
});
