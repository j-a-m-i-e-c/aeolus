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

/** Default panes — only for custom (unpinned) tabs. Pinned tabs render dedicated components. */
export const DEFAULT_PANES: Pane[] = [
  // Lighting tab (custom, not pinned)
  { id: "dp-hue-lights",     tabId: "default-lighting",    paneType: "hue-lights",       config: {},                                                                      x: 0,  y: 0,  w: 12, h: 8, createdAt: NOW },
];
