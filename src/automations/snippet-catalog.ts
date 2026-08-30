// src/automations/snippet-catalog.ts — Aggregates platform + connector code snippets for the editor

import type { ConnectorRegistry } from "../connectors/connector-registry.js";

/** A single code snippet for the automation script editor. */
export interface Snippet {
  id: string;
  name: string;
  description: string;
  code: string;
}

/** A group of snippets under a category label. */
export interface SnippetGroup {
  category: string;
  icon: string;
  snippets: Snippet[];
}

/** Platform-level snippets that are always available regardless of connectors. */
const PLATFORM_SNIPPETS: SnippetGroup[] = [
  {
    category: "MQTT",
    icon: "radio",
    snippets: [
      {
        id: "mqtt-publish",
        name: "Publish MQTT Message",
        description: "Publish a message to an MQTT topic",
        code: `mqtt.publish("home/living-room/command", JSON.stringify({ action: "notify" }));
log.info("Published MQTT message");`,
      },
      {
        id: "mqtt-forward",
        name: "Forward Event to Topic",
        description: "Re-publish the triggering event to another topic",
        code: `mqtt.publish("alerts/" + context.deviceId, JSON.stringify(context.state));
log.info(\`Forwarded \${context.topic} to alerts/\${context.deviceId}\`);`,
      },
    ],
  },
  {
    category: "HTTP",
    icon: "globe",
    snippets: [
      {
        id: "http-get",
        name: "HTTP GET Request",
        description: "Fetch data from a public API",
        code: `const res = await http.get("https://api.example.com/data");
log.info(\`API responded: \${res.status}\`);
state.set("lastApiResponse", res.body.slice(0, 200));`,
      },
      {
        id: "http-post-webhook",
        name: "POST Webhook",
        description: "Send a bounded POST request to a public webhook URL",
        code: `const res = await http.post("https://hooks.example.com/webhook", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event: context.topic,
    device: context.deviceId,
    state: context.state,
    timestamp: new Date(context.timestamp).toISOString(),
  }),
});
log.info(\`Webhook responded: \${res.status}\`);`,
      },
      {
        id: "http-slack-notify",
        name: "Slack Notification",
        description: "Send a notification to a Slack channel via webhook",
        code: `await http.post("https://hooks.slack.com/services/YOUR/WEBHOOK/URL", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: \`Aeolus: \${context.deviceId} triggered on \${context.topic}\` }),
});`,
      },
      {
        id: "http-discord-notify",
        name: "Discord Notification",
        description: "Send a notification to a Discord channel via webhook",
        code: `await http.post("https://discord.com/api/webhooks/YOUR/WEBHOOK", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: \`Aeolus: \${context.deviceId} triggered on \${context.topic}\` }),
});`,
      },
    ],
  },
  {
    category: "Conditions",
    icon: "filter",
    snippets: [
      {
        id: "cond-threshold",
        name: "Value Threshold Guard",
        description: "Return early unless a state value exceeds a threshold",
        code: `const value = Number(context.state.value);
if (!Number.isFinite(value) || value <= 25) return;`,
      },
      {
        id: "cond-time-window",
        name: "Time Window Guard",
        description: "Return early outside specific hours",
        code: `const hour = new Date(context.timestamp).getHours();
if (hour < 8 || hour >= 22) return; // only continue from 8am to 10pm`,
      },
      {
        id: "cond-device-online",
        name: "Device Online Guard",
        description: "Continue only when a device reports online",
        code: `const device = devices.get("my-device-id");
if (!device || device.state.online !== true) return;`,
      },
      {
        id: "cond-state-changed",
        name: "State Key Guard",
        description: "Continue only when the triggering event has a state key",
        code: `if (context.state.value === undefined) return;`,
      },
    ],
  },
  {
    category: "Devices",
    icon: "cpu",
    snippets: [
      {
        id: "device-toggle",
        name: "Toggle Device",
        description: "Toggle any device by ID through CommandService",
        code: `const result = await devices.action("my-device-id", "toggle");
if (!result.success) throw new Error(result.error ?? "Device command failed");
state.set("lastToggled", "my-device-id");`,
      },
      {
        id: "device-filter-type",
        name: "Control Devices by Type",
        description: "Control every matching scoped device",
        code: `const result = await devices.actionAll(
  (device) => device.type === "light",
  "toggle",
);
log.info(\`Controlled \${result.total} lights; \${result.failed} failed\`);`,
      },
      {
        id: "device-log-all",
        name: "Log All Scoped Devices",
        description: "Log the current scoped device snapshots",
        code: `const all = devices.list();
for (const device of all) {
  log.info(\`\${device.name} (\${device.id}): \${JSON.stringify(device.state)}\`);
}
state.set("deviceCount", all.length);`,
      },
    ],
  },
  {
    category: "Triggers",
    icon: "clock",
    snippets: [
      {
        id: "trigger-scheduled-run",
        name: "Scheduled Run Marker",
        description: "Record execution time for a Schedule-triggered Automation",
        code: `log.info(\`Scheduled automation ran at \${new Date(context.timestamp).toISOString()}\`);
state.set("lastRun", context.timestamp);`,
      },
      {
        id: "trigger-payload",
        name: "Trigger Payload",
        description: "Inspect the current trigger state; configure the trigger above the editor",
        code: `log.info(\`Trigger payload: \${JSON.stringify(context.state)}\`);
state.set("lastTrigger", { topic: context.topic, state: context.state, time: context.timestamp });`,
      },
    ],
  },
  {
    category: "Patterns",
    icon: "file-code",
    snippets: [
      {
        id: "pattern-guard-and-act",
        name: "Guard Then Act",
        description: "A compact module-style condition and command pattern",
        code: `const value = Number(context.state.value);
if (!Number.isFinite(value) || value <= 30) return;

const result = await devices.action("my-device-id", "off");
if (!result.success) throw new Error(result.error ?? "Device command failed");
state.set("lastAction", { value, time: context.timestamp });`,
      },
      {
        id: "pattern-multi-device",
        name: "Multi-Device Control",
        description: "Control matching devices and publish a summary",
        code: `const result = await devices.actionAll((device) => device.type === "plug", "off");
mqtt.publish("alerts/automation", JSON.stringify({
  controlled: result.total,
  failed: result.failed,
  timestamp: context.timestamp,
}));`,
      },
    ],
  },
];

/**
 * Build the complete snippet catalog by combining platform snippets
 * with connector-provided snippets from the registry.
 *
 * @param connectorRegistry - The connector registry to pull connector snippets from.
 * @param mode - Filter snippets by editor tab. "logic" (default) returns logic snippets,
 *   "ui" returns UI component snippets. Snippets without a mode field default to "logic".
 */
export function buildSnippetCatalog(connectorRegistry: ConnectorRegistry, mode: "logic" | "ui" = "logic"): SnippetGroup[] {
  // Platform snippets are logic-only; UI mode starts with an empty array
  const groups: SnippetGroup[] = mode === "logic" ? [...PLATFORM_SNIPPETS] : [];

  // Aggregate snippets from all registered connectors
  for (const { metadata } of connectorRegistry.listAvailable()) {
    const mod = connectorRegistry.getModule(metadata.id);
    if (!mod?.snippets?.length) continue;

    const filtered = mod.snippets
      .filter((s) => (s.mode ?? "logic") === mode)
      .map((s) => ({
        id: `${metadata.id}-${s.id}`,
        name: s.name,
        description: s.description,
        code: s.code,
      }));

    if (filtered.length > 0) {
      groups.push({
        category: metadata.displayName,
        icon: metadata.icon,
        snippets: filtered,
      });
    }
  }

  return groups;
}
