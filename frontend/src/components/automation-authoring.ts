import type { AutomationProjectSource } from "./AutomationProjectEditor";

/**
 * What wakes an automation.
 *
 * `shared-state` watches a durable Shared State path (`<bucket>/<key>`) rather
 * than a broker topic. The two are separate namespaces: a Shared State rule is
 * never woken by MQTT and vice versa, even when the pattern would match both.
 */
export type AutomationTriggerType = "mqtt" | "cron" | "none" | "shared-state";

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

/**
 * Validate a Shared State trigger pattern, mirroring the backend's rules.
 *
 * A stored value's path is exactly `<bucket>/<key>`, so a pattern has at most two
 * segments, and `+`/`#` are whole-segment wildcards only. This is a pre-flight
 * check for the authoring form; the server remains the authority.
 *
 * @returns an explanation, or `null` when the pattern is acceptable.
 */
export function describeSharedStatePatternProblem(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return "Give a Shared State path, such as bunker-summary/power";

  const segments = trimmed.split("/");
  if (segments.length > 2) {
    return "A Shared State path has two parts: bucket/key";
  }
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) return "A Shared State path may not have an empty part";
    if (segment === "#") {
      if (i !== segments.length - 1) return "'#' may only be the last part";
      continue;
    }
    if (segment === "+") continue;
    if (segment.includes("+") || segment.includes("#")) {
      return "'+' and '#' must be a whole part, not part of a name";
    }
  }
  return null;
}

/** Every trigger type, in one place so a narrowing check cannot fall behind. */
export const AUTOMATION_TRIGGER_TYPES: readonly AutomationTriggerType[] = [
  "mqtt",
  "cron",
  "none",
  "shared-state",
];

/**
 * Narrow an untrusted value (a persisted pane draft, an API response) to a
 * trigger type. Anything unrecognised is rejected so a stale draft falls back to
 * the default rather than rendering as a type the UI cannot configure.
 */
export function isAutomationTriggerType(value: unknown): value is AutomationTriggerType {
  return typeof value === "string" && (AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(value);
}

/**
 * Whether this trigger type is configured by a pattern.
 *
 * `mqtt` matches a broker topic and `shared-state` matches a `<bucket>/<key>`
 * Shared State path. Both are stored in the same field, so both must be sent;
 * `cron` and `none` carry no pattern at all.
 */
export function triggerCarriesPattern(triggerType: AutomationTriggerType): boolean {
  return triggerType === "mqtt" || triggerType === "shared-state";
}

export function triggerIsConfigured(
  triggerType: AutomationTriggerType,
  mqttTopic: string,
  cronExpression: string,
  cronIsValid: boolean,
): boolean {
  if (triggerType === "none") return true;
  if (triggerType === "cron") return cronExpression.trim().length > 0 && cronIsValid;
  // shared-state reuses the same pattern field as mqtt, but its pattern has to be
  // a valid Shared State path rather than any topic string.
  if (triggerType === "shared-state") {
    return describeSharedStatePatternProblem(mqttTopic) === null;
  }
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
  // Named "Shared State" rather than "MQTT" because it is emphatically not MQTT —
  // the path never reaches the broker.
  if (type === "shared-state") {
    return `Shared State · ${rule.topic?.trim() || "path not configured"}`;
  }
  return `MQTT · ${rule.topic?.trim() || "topic not configured"}`;
}
