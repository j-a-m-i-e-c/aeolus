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
  /** Trigger a device action from the component. */
  deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  /** Publish an MQTT message from the component. */
  mqttPublish: (topic: string, payload: string) => void;
  /** The most recent execution log entries for this rule. */
  executionHistory: ExecutionEntry[];
  /** Live key-value state from the Automation State Store, updated via WebSocket. */
  state: Map<string, unknown>;
  /** Write a key-value pair back to the Automation State Store (persisted + broadcast). */
  stateSet: (key: string, value: unknown) => void;
  /**
   * Persist the value to the state store AND immediately fire the Logic tab
   * with topic `ui/{ruleId}/state-set` and state `{ key, value }`.
   */
  stateSetAndFire: (key: string, value: unknown) => void;
}
