// frontend/src/lib/pane-registry.ts — Maps Pane_Type identifiers to React components and metadata

import type { ComponentType } from "react";
import type { PaneConfig } from "../types/dashboard";
import { DeviceGridPane } from "../components/panes/DeviceGridPane";
import { SensorPanelPane } from "../components/panes/SensorPanelPane";
import { MqttInspectorPane } from "../components/panes/MqttInspectorPane";
import { HueControlPane } from "../components/panes/HueControlPane";
import { KasaControlPane } from "../components/panes/KasaControlPane";
import { AutomationRulesPane } from "../components/panes/AutomationRulesPane";
import { AutomationsEditorPane } from "../components/panes/AutomationsEditorPane";
import { SystemStatsPane } from "../components/panes/SystemStatsPane";
import { TopicTreePane } from "../components/panes/TopicTreePane";
import { EventLogPane } from "../components/panes/EventLogPane";
import { ConnectorsPane } from "../components/panes/ConnectorsPane";
import { TriggerButtonPane } from "../components/panes/TriggerButtonPane";
import { AutomationCardPane } from "../components/panes/AutomationCardPane";

export interface PaneRegistryEntry {
  component: ComponentType<{ config: PaneConfig }>;
  displayName: string;
  defaultIcon: string;
  defaultConfig: PaneConfig;
  defaultSize: { w: number; h: number };
  category: "controls" | "automations" | "monitoring" | "system";
}

export const PANE_REGISTRY: Record<string, PaneRegistryEntry> = {
  // ── Controls ──
  "device-grid": {
    component: DeviceGridPane,
    displayName: "Device Grid",
    defaultIcon: "cpu",
    defaultConfig: {},
    defaultSize: { w: 12, h: 5 },
    category: "controls",
  },
  "hue-control": {
    component: HueControlPane,
    displayName: "Hue Lights",
    defaultIcon: "lightbulb",
    defaultConfig: {},
    defaultSize: { w: 12, h: 6 },
    category: "controls",
  },
  "kasa-control": {
    component: KasaControlPane,
    displayName: "Kasa Devices",
    defaultIcon: "plug",
    defaultConfig: {},
    defaultSize: { w: 12, h: 6 },
    category: "controls",
  },
  "trigger-button": {
    component: TriggerButtonPane,
    displayName: "Trigger Button",
    defaultIcon: "zap",
    defaultConfig: { triggerName: "my-trigger", label: "Fire!", color: "primary" },
    defaultSize: { w: 4, h: 3 },
    category: "controls",
  },

  // ── Automations ──
  "automations-editor": {
    component: AutomationsEditorPane,
    displayName: "Automation Editor",
    defaultIcon: "code",
    defaultConfig: {},
    defaultSize: { w: 12, h: 10 },
    category: "automations",
  },
  "automation-rules": {
    component: AutomationRulesPane,
    displayName: "Automation List",
    defaultIcon: "git-branch",
    defaultConfig: {},
    defaultSize: { w: 12, h: 8 },
    category: "automations",
  },
  "automation-card": {
    component: AutomationCardPane,
    displayName: "Automation Card",
    defaultIcon: "git-branch",
    defaultConfig: { ruleId: "" },
    defaultSize: { w: 6, h: 3 },
    category: "automations",
  },

  // ── Monitoring ──
  "sensor-panel": {
    component: SensorPanelPane,
    displayName: "Sensor Panel",
    defaultIcon: "thermometer",
    defaultConfig: {},
    defaultSize: { w: 12, h: 4 },
    category: "monitoring",
  },
  "mqtt-inspector": {
    component: MqttInspectorPane,
    displayName: "MQTT Inspector",
    defaultIcon: "radio",
    defaultConfig: {},
    defaultSize: { w: 6, h: 5 },
    category: "monitoring",
  },
  "topic-tree": {
    component: TopicTreePane,
    displayName: "Topic Tree",
    defaultIcon: "folder-tree",
    defaultConfig: {},
    defaultSize: { w: 6, h: 5 },
    category: "monitoring",
  },
  "event-log": {
    component: EventLogPane,
    displayName: "Event Log",
    defaultIcon: "scroll-text",
    defaultConfig: {},
    defaultSize: { w: 12, h: 4 },
    category: "monitoring",
  },

  // ── System ──
  "system-stats": {
    component: SystemStatsPane,
    displayName: "System Stats",
    defaultIcon: "server",
    defaultConfig: {},
    defaultSize: { w: 12, h: 3 },
    category: "system",
  },
  "connectors-page": {
    component: ConnectorsPane,
    displayName: "Connectors",
    defaultIcon: "plug",
    defaultConfig: {},
    defaultSize: { w: 12, h: 8 },
    category: "system",
  },
};

/** Look up a registry entry by pane type. Returns undefined for unknown types. */
export function getPaneEntry(paneType: string): PaneRegistryEntry | undefined {
  return PANE_REGISTRY[paneType];
}
