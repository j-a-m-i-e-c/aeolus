// src/websocket/data-store-visibility.ts — Scope Data Store live events to tabs.
//
// Data Store events (data-store-write, data-store-collection-deleted) carry the
// `collection` name in their payload. This resolver derives the broadcast
// visibility from the tabs that surface that collection, so a non-admin viewing
// the collection on one of their tabs receives its updates. A collection no pane
// surfaces resolves to an empty tab set, which the WsServer treats as admin-only
// (fail-closed) — the pre-existing behaviour for unsurfaced collections.

import type { BroadcastEnvelope } from "./ws-server.js";
import type { CollectionOwnershipStore } from "../auth/collection-ownership-store.js";

/** Read a string field from an untrusted event payload; null when absent/non-string. */
function stringField(data: unknown, field: string): string | null {
  if (data && typeof data === "object" && field in data) {
    const value = (data as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Build the visibility resolver for Data Store events from the collection
 * ownership store. The collection name is taken only from the server-side event
 * payload, never from client input.
 */
export function createDataStoreVisibility(
  store: CollectionOwnershipStore,
): (data: unknown) => BroadcastEnvelope {
  return (data: unknown): BroadcastEnvelope => {
    const collection = stringField(data, "collection");
    if (!collection) return { visibility: "admin" };
    return { visibility: "tabs", tabIds: store.getExposingTabs(collection) };
  };
}
