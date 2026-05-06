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
        code: `function publishMessage(context) {
  mqtt.publish("home/living-room/command", JSON.stringify({ action: "notify" }));
  log.info("Published MQTT message");
}`,
      },
      {
        id: "mqtt-forward",
        name: "Forward Event to Topic",
        description: "Re-publish the triggering event to another topic",
        code: `function forwardEvent(context) {
  mqtt.publish("alerts/" + context.deviceId, JSON.stringify(context.state));
  log.info(\`Forwarded \${context.topic} to alerts/\${context.deviceId}\`);
}`,
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
        description: "Fetch data from an external API",
        code: `async function fetchData(context) {
  const res = await http.get("https://api.example.com/data");
  log.info(\`API responded: \${res.status}\`);
  state.set("lastApiResponse", res.body.slice(0, 200));
}`,
      },
      {
        id: "http-post-webhook",
        name: "POST Webhook",
        description: "Send a POST request to a webhook URL",
        code: `async function postWebhook(context) {
  const res = await http.post("https://hooks.example.com/webhook", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: context.topic,
      device: context.deviceId,
      state: context.state,
      timestamp: new Date(context.timestamp).toISOString(),
    }),
  });
  log.info(\`Webhook responded: \${res.status}\`);
  state.set("lastWebhookStatus", res.status);
}`,
      },
      {
        id: "http-slack-notify",
        name: "Slack Notification",
        description: "Send a notification to a Slack channel via webhook",
        code: `async function notifySlack(context) {
  await http.post("https://hooks.slack.com/services/YOUR/WEBHOOK/URL", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: \`🏠 Aeolus: \${context.deviceId} triggered on \${context.topic}\`,
    }),
  });
  log.info("Sent Slack notification");
}`,
      },
      {
        id: "http-discord-notify",
        name: "Discord Notification",
        description: "Send a notification to a Discord channel via webhook",
        code: `async function notifyDiscord(context) {
  await http.post("https://discord.com/api/webhooks/YOUR/WEBHOOK", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: \`🏠 **Aeolus**: \\\`\${context.deviceId}\\\` triggered on \\\`\${context.topic}\\\`\`,
    }),
  });
  log.info("Sent Discord notification");
}`,
      },
    ],
  },
  {
    category: "Conditions",
    icon: "filter",
    snippets: [
      {
        id: "cond-threshold",
        name: "Value Threshold",
        description: "Check if a state value exceeds a threshold",
        code: `function aboveThreshold(context) {
  const value = context.state.value as number;
  return typeof value === "number" && value > 25;
}`,
      },
      {
        id: "cond-time-window",
        name: "Time Window",
        description: "Only allow execution during specific hours",
        code: `function isDuringHours(context) {
  const hour = new Date(context.timestamp).getHours();
  return hour >= 8 && hour < 22; // 8am to 10pm
}`,
      },
      {
        id: "cond-device-online",
        name: "Device Is Online",
        description: "Check if a specific device is currently online",
        code: `function isDeviceOnline(context) {
  const device = devices.get("my-device-id");
  return device !== undefined && device.state.online === true;
}`,
      },
      {
        id: "cond-state-changed",
        name: "State Value Changed",
        description: "Check that the triggering event has a specific state key",
        code: `function hasStateKey(context) {
  return context.state.value !== undefined;
}`,
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
        description: "Toggle any device on or off by ID",
        code: `function toggleDevice(context) {
  devices.action("my-device-id", "toggle");
  log.info("Toggled device");
  state.set("lastToggled", context.deviceId);
  state.set("lastToggleTime", Date.now());
}`,
      },
      {
        id: "device-filter-type",
        name: "Filter Devices by Type",
        description: "Get all devices of a specific type",
        code: `function controlByType(context) {
  const lights = devices.filter(d => d.type === "light");
  for (const light of lights) {
    devices.action(light.id, "toggle");
  }
  log.info(\`Toggled \${lights.length} lights\`);
  state.set("lightsControlled", lights.length);
}`,
      },
      {
        id: "device-log-all",
        name: "Log All Devices",
        description: "Log the current state of all registered devices",
        code: `function logAllDevices(context) {
  const all = devices.list();
  for (const d of all) {
    log.info(\`\${d.name} (\${d.id}): \${JSON.stringify(d.state)}\`);
  }
  state.set("deviceCount", all.length);
}`,
      },
    ],
  },
  {
    category: "Services",
    icon: "clock",
    snippets: [
      {
        id: "svc-cron-listener",
        name: "Cron Schedule Listener",
        description: "Full automation template listening to a cron schedule",
        code: `// Trigger topic: service/cron/every-5m
automation({
  actions: [
    function onSchedule(context) {
      log.info(\`Cron fired: \${context.state.scheduleName} at \${new Date(context.timestamp).toISOString()}\`);
      state.set("lastRun", Date.now());
    },
  ],
});`,
      },
      {
        id: "svc-trigger-listener",
        name: "API Trigger Listener",
        description: "Full automation template listening to an API trigger",
        code: `// Trigger topic: service/trigger/my-trigger
automation({
  actions: [
    function onTrigger(context) {
      const payload = context.state.payload;
      log.info(\`API trigger fired with payload: \${JSON.stringify(payload)}\`);
      state.set("lastTriggerPayload", payload);
      state.set("lastTriggerTime", Date.now());
    },
  ],
});`,
      },
      {
        id: "svc-check-service",
        name: "Check Service State",
        description: "Read the current state of a running service",
        code: `function checkServiceState(context) {
  const cronState = services.get("cron");
  if (cronState) {
    log.info(\`Cron service state: \${JSON.stringify(cronState)}\`);
  } else {
    log.warn("Cron service not running");
  }
}`,
      },
    ],
  },
  {
    category: "Templates",
    icon: "file-code",
    snippets: [
      {
        id: "tpl-full-automation",
        name: "Full Automation Template",
        description: "Complete automation with conditions and actions",
        code: `automation({
  conditions: [
    function checkCondition(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function executeAction(context) {
      log.info(\`Event on \${context.topic}: \${JSON.stringify(context.state)}\`);
      state.set("lastEvent", { topic: context.topic, value: context.state.value, time: Date.now() });
    },
  ],
});`,
      },
      {
        id: "tpl-multi-device",
        name: "Multi-Device Control",
        description: "Control multiple devices based on a sensor reading",
        code: `automation({
  conditions: [
    function isAboveThreshold(context) {
      return (context.state.value as number) > 30;
    },
  ],
  actions: [
    function controlDevices(context) {
      const plugs = devices.filter(d => d.type === "plug");
      for (const plug of plugs) {
        devices.action(plug.id, "off");
      }
      log.info(\`Turned off \${plugs.length} plugs — threshold exceeded\`);
      state.set("lastAction", "plugs_off");
      state.set("triggerValue", context.state.value);
    },
    function notifyMqtt(context) {
      mqtt.publish("alerts/threshold", JSON.stringify({
        value: context.state.value,
        action: "plugs_off",
        timestamp: new Date(context.timestamp).toISOString(),
      }));
    },
  ],
});`,
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
