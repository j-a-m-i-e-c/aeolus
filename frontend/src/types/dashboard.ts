// frontend/src/types/dashboard.ts — Shared TypeScript interfaces for the modular dashboard

/** A user-defined navigation entry in the sidebar */
export interface Tab {
  id: string;          // UUID v4
  name: string;        // User-provided, non-empty
  icon: string;        // Lucide icon name, e.g. "cpu", "lightbulb", "zap"
  order: number;       // Display order (0-based, ascending)
  pinned: boolean;     // Pinned tabs appear at the top, cannot be deleted or reordered
  createdAt: number;   // Unix timestamp ms
}

/** Type-specific filter/display configuration for a Pane */
export interface PaneConfig {
  room?: string;
  deviceType?: string;
  topicPattern?: string;
  showSections?: string[];
  [key: string]: unknown;
}

/** A reusable UI building block placed on a Tab */
export interface Pane {
  id: string;          // UUID v4
  tabId: string;       // Foreign key → Tab.id
  paneType: string;    // Key into Pane_Registry, e.g. "device-grid"
  config: PaneConfig;  // Type-specific filter/display config
  x: number;           // Grid column position (0-based)
  y: number;           // Grid row position (0-based)
  w: number;           // Width in grid columns (1-12)
  h: number;           // Height in grid rows (min 2)
  createdAt: number;   // Unix timestamp ms
}

/** API transport shape for GET/PUT /api/layout */
export interface LayoutPayload {
  tabs: Tab[];
  panes: Pane[];
}

// ---------------------------------------------------------------------------
// Default_Layout seed data — used on first launch when no saved layout exists
// ---------------------------------------------------------------------------

const NOW = Date.now();

/** Default tabs: 4 pinned system tabs + 1 custom tab */
export const DEFAULT_TABS: Tab[] = [
  { id: "default-dashboard",   name: "Dashboard",   icon: "cpu",       order: 0, pinned: true,  createdAt: NOW },
  { id: "default-automations", name: "Automations", icon: "zap",       order: 1, pinned: true,  createdAt: NOW },
  { id: "default-connectors",  name: "Connectors",  icon: "plug",      order: 2, pinned: true,  createdAt: NOW },
  { id: "default-system",      name: "System",      icon: "server",    order: 3, pinned: true,  createdAt: NOW },
  { id: "default-lighting",    name: "Lighting",    icon: "lightbulb", order: 4, pinned: false, createdAt: NOW },
];

/** Default panes arranged across the four default tabs */
export const DEFAULT_PANES: Pane[] = [
  // Dashboard tab
  { id: "dp-system-stats",   tabId: "default-dashboard",   paneType: "system-stats",     config: {},                                                                      x: 0,  y: 0,  w: 12, h: 3, createdAt: NOW },
  { id: "dp-sensor-panel",   tabId: "default-dashboard",   paneType: "sensor-panel",     config: {},                                                                      x: 0,  y: 3,  w: 12, h: 4, createdAt: NOW },
  { id: "dp-device-grid",    tabId: "default-dashboard",   paneType: "device-grid",      config: {},                                                                      x: 0,  y: 7,  w: 12, h: 5, createdAt: NOW },
  { id: "dp-mqtt-inspector", tabId: "default-dashboard",   paneType: "mqtt-inspector",   config: {},                                                                      x: 0,  y: 12, w: 6,  h: 5, createdAt: NOW },
  { id: "dp-topic-tree",     tabId: "default-dashboard",   paneType: "topic-tree",       config: {},                                                                      x: 6,  y: 12, w: 6,  h: 5, createdAt: NOW },
  { id: "dp-event-log",      tabId: "default-dashboard",   paneType: "event-log",        config: {},                                                                      x: 0,  y: 17, w: 12, h: 4, createdAt: NOW },
  // Automations tab
  { id: "dp-auto-rules",     tabId: "default-automations", paneType: "automation-rules", config: {},                                                                      x: 0,  y: 0,  w: 12, h: 8, createdAt: NOW },
  // Connectors tab
  { id: "dp-connectors",     tabId: "default-connectors",  paneType: "connectors-page", config: {},                                                                      x: 0,  y: 0,  w: 12, h: 8, createdAt: NOW },
  // System tab
  { id: "dp-sys-diag",       tabId: "default-system",      paneType: "system-stats",     config: { showSections: ["host", "cpu", "temperature", "memory", "disk", "network"] }, x: 0, y: 0, w: 12, h: 8, createdAt: NOW },
  // Lighting tab (custom, not pinned)
  { id: "dp-hue-lights",     tabId: "default-lighting",    paneType: "hue-lights",       config: {},                                                                      x: 0,  y: 0,  w: 12, h: 8, createdAt: NOW },
];
