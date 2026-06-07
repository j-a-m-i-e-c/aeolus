// frontend/src/components/panes/custom/types.ts — Props interface for custom automation UI components

import type { Device } from "../../../store/device-store";

export interface ExecutionEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggerTopic: string;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;
  timestamp: number;
}

export interface CustomComponentProps {
  /** All devices from the Aeolus device registry. */
  devices: Device[];
  /** The automation rule's unique identifier. */
  ruleId: string;
  /** The automation rule's display name. */
  ruleName: string;
  /** Unix timestamp of the most recent execution, or null if never fired. */
  lastFired: number | null;
  /** Whether the automation rule is currently enabled. */
  enabled: boolean;
  /** Read a value from the shared state store (written by the Logic tab via state.set()). */
  read: (key: string) => unknown;
  /** Persist a key-value pair to the Automation State Store (persisted + broadcast). */
  save: (key: string, value: unknown) => void;
  /**
   * Persist the value to the state store AND immediately fire the Logic tab
   * with topic `ui/{ruleId}/state-set` and state `{ key, value }`.
   */
  saveAndFire: (key: string, value: unknown) => void;
  /**
   * Fire the Logic tab script with a named UI event.
   *
   * Use this when the UI needs to delegate a decision to the Logic tab
   * rather than issuing a direct device command. The Logic tab receives
   * the event as `context.topic = "ui/{ruleId}/{eventName}"` with
   * `context.state` containing the payload.
   *
   * @param eventName - A short name for the event (e.g. "target-changed", "mode-selected").
   * @param payload - Optional data to pass to the Logic tab in `context.state`.
   */
  fire: (eventName: string, payload?: Record<string, unknown>) => void;
  /** Control a device from the component. */
  control: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  /** Send an MQTT message from the component. */
  publish: (topic: string, payload: string) => void;
  /** The most recent execution log entries for this rule. */
  history: ExecutionEntry[];
}
