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

/** Default tabs: 3 pinned system tabs */
export const DEFAULT_TABS: Tab[] = [
  { id: "default-dashboard",   name: "System",      icon: "server",    order: 0, pinned: true,  createdAt: NOW },
  { id: "default-connectors",  name: "Connectors",  icon: "plug",      order: 1, pinned: true,  createdAt: NOW },
  { id: "default-data-store",  name: "Data",        icon: "database",  order: 2, pinned: true,  createdAt: NOW },
];

/** Default panes — empty, users add their own via PanePicker. */
export const DEFAULT_PANES: Pane[] = [];
