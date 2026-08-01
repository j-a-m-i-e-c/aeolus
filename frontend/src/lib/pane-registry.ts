// frontend/src/lib/pane-registry.ts — Maps Pane_Type identifiers to React components and metadata

import type { ComponentType } from "react";
import type { PaneConfig } from "../types/dashboard";
import { SensorPanelPane } from "../components/panes/SensorPanelPane";
import { MqttInspectorPane } from "../components/panes/MqttInspectorPane";
import { HueControlPane } from "../components/panes/HueControlPane";
import { KasaControlPane } from "../components/panes/KasaControlPane";
import { AutomationRulesPane } from "../components/panes/AutomationRulesPane";
import { AutomationPane } from "../components/panes/AutomationPane";
import { SystemStatsPane } from "../components/panes/SystemStatsPane";
import { TopicTreePane } from "../components/panes/TopicTreePane";
import { EventLogPane } from "../components/panes/EventLogPane";
import { ConnectorsPane } from "../components/panes/ConnectorsPane";
import { TriggerButtonPane } from "../components/panes/TriggerButtonPane";
import { StateHistoryPane } from "../components/panes/StateHistoryPane";
import { ScheduleViewerPane } from "../components/panes/ScheduleViewerPane";
import { MetricsPane } from "../components/panes/MetricsPane";
import { MetricsChartsPane } from "../components/panes/MetricsChartsPane";

export interface PaneRegistryEntry {
  component: ComponentType<{ config: PaneConfig; paneId?: string }>;
  displayName: string;
  defaultIcon: string;
  defaultConfig: PaneConfig;
  defaultSize: { w: number; h: number };
  category: "controls" | "automations" | "monitoring" | "system";
}

export const PANE_REGISTRY: Record<string, PaneRegistryEntry> = {
  // ── Controls ──
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
  "automation": {
    component: AutomationPane,
    displayName: "Automation",
    defaultIcon: "code",
    defaultConfig: { ruleId: "" },
    defaultSize: { w: 6, h: 9 },
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
  "state-history": {
    component: StateHistoryPane,
    displayName: "State History",
    defaultIcon: "line-chart",
    defaultConfig: { timeRange: "1h" },
    defaultSize: { w: 6, h: 5 },
    category: "monitoring",
  },
  "schedule-viewer": {
    component: ScheduleViewerPane,
    displayName: "Cron Schedule Viewer",
    defaultIcon: "calendar-clock",
    defaultConfig: {},
    defaultSize: { w: 6, h: 6 },
    category: "monitoring",
  },
  "metrics": {
    component: MetricsPane,
    displayName: "Metrics",
    defaultIcon: "activity",
    defaultConfig: {},
    defaultSize: { w: 12, h: 5 },
    category: "monitoring",
  },
  "metrics-charts": {
    component: MetricsChartsPane,
    displayName: "Metrics History",
    defaultIcon: "bar-chart-3",
    defaultConfig: {},
    defaultSize: { w: 12, h: 6 },
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
