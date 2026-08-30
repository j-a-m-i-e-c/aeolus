import type { AutomationProjectSource } from "./AutomationProjectEditor";

export type AutomationTriggerType = "mqtt" | "cron" | "none";

export interface TranspileError {
  path?: string;
  line: number;
  column: number;
  message: string;
}

/** One canonical scaffold for every new Automation Project authoring surface. */
export function createDefaultAutomationProject(): AutomationProjectSource {
  return {
    logicEntry: "logic/index.ts",
    uiEntry: null,
    files: [
      {
        path: "logic/index.ts",
        content: `export default async function run(context: EventContext) {
  log.info(\`Event: \${context.topic}\`);
  state.set("lastEvent", { topic: context.topic, at: Date.now() });
}
`,
      },
    ],
  };
}

export function triggerIsConfigured(
  triggerType: AutomationTriggerType,
  mqttTopic: string,
  cronExpression: string,
  cronIsValid: boolean,
): boolean {
  if (triggerType === "none") return true;
  if (triggerType === "cron") return cronExpression.trim().length > 0 && cronIsValid;
  return mqttTopic.trim().length > 0;
}

export function describeAutomationTrigger(rule: {
  triggerType?: AutomationTriggerType;
  topic?: string;
  cronExpression?: string | null;
}): string {
  const type = rule.triggerType ?? "mqtt";
  if (type === "none") return "Manual only";
  if (type === "cron") return `Schedule · ${rule.cronExpression?.trim() || "not configured"}`;
  return `MQTT · ${rule.topic?.trim() || "topic not configured"}`;
}
