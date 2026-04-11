// frontend/src/lib/pane-registry.ts — Maps Pane_Type identifiers to React components and metadata

import type { ComponentType } from "react";
import type { PaneConfig } from "../types/dashboard";
import { DeviceGridPane } from "../components/panes/DeviceGridPane";
import { SensorPanelPane } from "../components/panes/SensorPanelPane";
import { MqttInspectorPane } from "../components/panes/MqttInspectorPane";
import { HueLightsPane } from "../components/panes/HueLightsPane";
import { AutomationRulesPane } from "../components/panes/AutomationRulesPane";
import { SystemStatsPane } from "../components/panes/SystemStatsPane";
import { TopicTreePane } from "../components/panes/TopicTreePane";
import { EventLogPane } from "../components/panes/EventLogPane";

export interface PaneRegistryEntry {
  component: ComponentType<{ config: PaneConfig }>;
  displayName: string;
  defaultIcon: string;
  defaultConfig: PaneConfig;
  defaultSize: { w: number; h: number };
}

export const PANE_REGISTRY: Record<string, PaneRegistryEntry> = {
  "device-grid": {
    component: DeviceGridPane,
    displayName: "Device Grid",
    defaultIcon: "cpu",
    defaultConfig: {},
    defaultSize: { w: 12, h: 5 },
  },
  "sensor-panel": {
    component: SensorPanelPane,
    displayName: "Sensor Panel",
    defaultIcon: "thermometer",
    defaultConfig: {},
    defaultSize: { w: 12, h: 4 },
  },
  "mqtt-inspector": {
    component: MqttInspectorPane,
    displayName: "MQTT Inspector",
    defaultIcon: "radio",
    defaultConfig: {},
    defaultSize: { w: 6, h: 5 },
  },
  "hue-lights": {
    component: HueLightsPane,
    displayName: "Hue Lights",
    defaultIcon: "lightbulb",
    defaultConfig: {},
    defaultSize: { w: 12, h: 8 },
  },
  "automation-rules": {
    component: AutomationRulesPane,
    displayName: "Automation Rules",
    defaultIcon: "zap",
    defaultConfig: {},
    defaultSize: { w: 12, h: 8 },
  },
  "system-stats": {
    component: SystemStatsPane,
    displayName: "System Stats",
    defaultIcon: "server",
    defaultConfig: {},
    defaultSize: { w: 12, h: 3 },
  },
  "topic-tree": {
    component: TopicTreePane,
    displayName: "Topic Tree",
    defaultIcon: "folder-tree",
    defaultConfig: {},
    defaultSize: { w: 6, h: 5 },
  },
  "event-log": {
    component: EventLogPane,
    displayName: "Event Log",
    defaultIcon: "scroll-text",
    defaultConfig: {},
    defaultSize: { w: 12, h: 4 },
  },
};

/** Look up a registry entry by pane type. Returns undefined for unknown types. */
export function getPaneEntry(paneType: string): PaneRegistryEntry | undefined {
  return PANE_REGISTRY[paneType];
}
