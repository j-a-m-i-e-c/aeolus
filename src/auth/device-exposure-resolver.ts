// src/auth/device-exposure-resolver.ts — Live, unpersisted device→tab exposure resolution

import type { Database as DatabaseType } from "better-sqlite3";
import type { Device } from "../core/types.js";
import type { DeviceRegistry } from "../core/device-registry.js";
import { getDatabase } from "../db/database.js";
import { matchesDeviceFilter, type DeviceFilterPane } from "./device-filter.js";

/**
 * Computes a device's exposing tabs live at evaluation time by matching each
 * tab's purposeful device panes against the current device inventory. It
 * persists nothing and reads no tab identifier from the request, so device
 * exposure is always fresh: a device that matches an existing pane's filter is
 * reachable on the next evaluation with no stored assignment and no admin action.
 */
export interface DeviceExposureResolver {
  /**
   * The set of tab ids that currently expose the given device. A tab is included
   * iff it has at least one purposeful device pane (`hue-control`,
   * `kasa-control`, `sensor-panel`) whose device-selection filter matches the
   * device against the current inventory. Every other pane type is non-exposing
   * by default. Returns an empty array when no purposeful pane matches (including
   * when the device does not exist).
   */
  getExposingTabs(deviceId: string): string[];

  /**
   * Batch form for device read filtering. Returns a map deviceId → exposing tab
   * ids for every id in `deviceIds` (empty array when none). Loads panes once and
   * evaluates each device against them.
   */
  getExposingTabsBatch(deviceIds: string[]): Map<string, string[]>;
}

interface PaneRow {
  tab_id: string;
  pane_type: string;
  config: string;
}

interface LoadedPane {
  tabId: string;
  pane: DeviceFilterPane;
}

/**
 * Create a DeviceExposureResolver backed by the injected DeviceRegistry (the
 * live inventory) and the shared database singleton (for the current panes).
 */
export function createDeviceExposureResolver(
  registry: DeviceRegistry,
  dbOverride?: DatabaseType,
): DeviceExposureResolver {
  function loadPanes(): LoadedPane[] {
    const db = dbOverride ?? getDatabase();
    const rows = db
      .prepare("SELECT tab_id, pane_type, config FROM panes")
      .all() as PaneRow[];
    return rows.map((row) => ({
      tabId: row.tab_id,
      pane: { paneType: row.pane_type, config: parseConfig(row.config) },
    }));
  }

  function exposingTabsFor(device: Device, panes: LoadedPane[]): string[] {
    const tabs = new Set<string>();
    for (const { tabId, pane } of panes) {
      if (matchesDeviceFilter(pane, device)) {
        tabs.add(tabId);
      }
    }
    return Array.from(tabs);
  }

  function getExposingTabs(deviceId: string): string[] {
    const device = registry.getById(deviceId);
    if (!device) {
      return [];
    }
    return exposingTabsFor(device, loadPanes());
  }

  function getExposingTabsBatch(deviceIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const id of deviceIds) {
      result.set(id, []);
    }
    if (deviceIds.length === 0) {
      return result;
    }

    const panes = loadPanes();
    for (const id of deviceIds) {
      const device = registry.getById(id);
      if (device) {
        result.set(id, exposingTabsFor(device, panes));
      }
    }
    return result;
  }

  return { getExposingTabs, getExposingTabsBatch };
}

/** Parse a pane's stored JSON config, normalizing anything malformed to `{}`. */
function parseConfig(raw: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
