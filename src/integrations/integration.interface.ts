// src/integrations/integration.interface.ts — Standard integration contract

import type { Device, Action } from "../core/types.js";

/** Interface that all device integrations must implement */
export interface Integration {
  /** Unique name identifying this integration (e.g. "hue", "mqtt") */
  name: string;

  /** Connect to the external device system */
  connect(): Promise<void>;

  /** Discover available devices and return them in normalized format */
  discoverDevices(): Promise<Device[]>;

  /** Execute a control action on a device */
  execute(action: Action): Promise<void>;

  /** Release resources and disconnect */
  dispose(): Promise<void>;
}
