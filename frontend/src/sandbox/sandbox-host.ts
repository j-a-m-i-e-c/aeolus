// frontend/src/sandbox/sandbox-host.ts — Host-side singleton broker + privileged deps
//
// A single SdkBroker manages every sandbox frame in the dashboard (design decision
// 4). Its BrokerDeps are bound here to the trusted primitives: authFetch (carrying
// the auth token), the device-action and MQTT-publish endpoints, and the automation
// state store. The frame never sees any of these — it only sends RPC requests that
// the broker executes on its behalf, always scoped to the frame's granted entity.

import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";
import {
  useAutomationStateStore,
  sendStateUpdate,
  sendStateUpdateAndFire,
} from "../store/automation-state-store";
import { SdkBroker, type BrokerDeps } from "./sdk-broker";
import type { EntityType } from "./rpc-types";

// ─── Privileged effect implementations ──────────────────────────────────────

/** Device action — identical to AutomationPane's `control` callback. */
async function control(
  _entityId: string,
  deviceId: string,
  actionType: string,
  params?: Record<string, unknown>,
): Promise<void> {
  await authFetch(`${API_URL}/api/devices/${deviceId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: actionType, params }),
  });
}

/** MQTT publish — identical to AutomationPane's `publish` callback. */
function publish(topic: string, payload: string): void {
  authFetch(`${API_URL}/api/mqtt/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, payload }),
  }).catch(() => {
    // Fire-and-forget — WebSocket sync covers transient failures.
  });
}

/** Persist a state key/value, scoped to the entity. */
function save(entityType: EntityType, entityId: string, key: string, value: unknown): void {
  if (entityType === "automation") {
    sendStateUpdate(entityId, key, value);
    return;
  }
  // Panel path (custom-panels): parallel endpoint, ready for when the store lands.
  authFetch(`${API_URL}/api/panels/${entityId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

/** Persist state AND fire the logic tab, scoped to the entity. */
function saveAndFire(entityType: EntityType, entityId: string, key: string, value: unknown): void {
  if (entityType === "automation") {
    sendStateUpdateAndFire(entityId, key, value);
    return;
  }
  save(entityType, entityId, key, value);
  authFetch(`${API_URL}/api/panels/${entityId}/fire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { topic: `ui/${entityId}/state-set`, state: { key, value } } }),
  }).catch(() => {});
}

/** Fire a named UI event, scoped to the entity. Matches the pane's `fire` body shape. */
function fire(
  entityType: EntityType,
  entityId: string,
  eventName: string,
  payload?: Record<string, unknown>,
): void {
  const base = entityType === "automation" ? "automations" : "panels";
  authFetch(`${API_URL}/api/${base}/${entityId}/fire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, ...(payload ?? {}) }),
  }).catch(() => {});
}

/** Read the latest cached state value for a key. */
function readState(entityType: EntityType, entityId: string, key: string): unknown {
  if (entityType === "automation") {
    return useAutomationStateStore.getState().stateByRule[entityId]?.[key];
  }
  // No panel-state store in the repo yet; degrade to undefined until it lands.
  return undefined;
}

/** Schedule a callback on the next animation frame (with a setTimeout fallback). */
function scheduleFlush(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => callback());
  } else {
    setTimeout(callback, 16);
  }
}

/**
 * Subscribe to state changes for an entity. For automations this diffs the
 * automation state store's per-rule slice and forwards each changed key. Rapid
 * changes are coalesced per animation frame (keeping the latest value per key) to
 * bound RPC messaging overhead on constrained hardware (Requirement 7.2). Returns
 * an unsubscribe function.
 */
function subscribeState(
  entityType: EntityType,
  entityId: string,
  callback: (key: string, value: unknown) => void,
): () => void {
  if (entityType !== "automation") {
    // Panel-state store not present yet; no-op subscription.
    return () => {};
  }

  let previous: Record<string, unknown> =
    useAutomationStateStore.getState().stateByRule[entityId] ?? {};

  // Pending coalesced changes: key → latest value, flushed once per frame.
  const pending = new Map<string, unknown>();
  let flushScheduled = false;
  let disposed = false;

  const flush = () => {
    flushScheduled = false;
    if (disposed) return;
    for (const [key, value] of pending) {
      callback(key, value);
    }
    pending.clear();
  };

  const unsubscribe = useAutomationStateStore.subscribe((state) => {
    const next = state.stateByRule[entityId] ?? {};
    if (next === previous) return;
    for (const [key, value] of Object.entries(next)) {
      if (!Object.is(previous[key], value)) {
        pending.set(key, value);
      }
    }
    previous = next;
    if (pending.size > 0 && !flushScheduled) {
      flushScheduled = true;
      scheduleFlush(flush);
    }
  });

  return () => {
    disposed = true;
    pending.clear();
    unsubscribe();
  };
}

const brokerDeps: BrokerDeps = {
  control,
  publish,
  save,
  saveAndFire,
  fire,
  readState,
  subscribeState,
};

/** The shared singleton broker for all sandbox frames. */
export const sandboxBroker = new SdkBroker(brokerDeps);
