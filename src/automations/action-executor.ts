// src/automations/action-executor.ts — Central dispatch service for all automation actions

import type { Logger } from "pino";
import type { MqttService } from "../mqtt/mqtt-service.js";
import type { ConnectorManager } from "../connectors/connector-manager.js";
import { eventBus, AUTOMATION_FIRED } from "../core/event-bus.js";

/** Descriptor for a single automation action to be dispatched. */
export interface ActionDescriptor {
  type: "publish" | "toggle" | "device_action" | "log" | "delay" | "webhook";
  target: string;
  params: Record<string, unknown>;
}

/** Dependencies injected into the ActionExecutor. */
export interface ActionExecutorDeps {
  mqttService: MqttService;
  connectorManager: ConnectorManager;
  logger: Logger;
}

/**
 * Dispatches automation action descriptors to the appropriate service.
 *
 * Every action — whether from a form rule, script rule, or file-based rule —
 * flows through this single pipeline. Each action is wrapped in try/catch;
 * errors are logged with the rule ID and never thrown.
 */
export class ActionExecutor {
  private mqttService: MqttService;
  private connectorManager: ConnectorManager;
  private logger: Logger;

  constructor(deps: ActionExecutorDeps) {
    this.mqttService = deps.mqttService;
    this.connectorManager = deps.connectorManager;
    this.logger = deps.logger;
  }

  /** Execute a single action descriptor. Never throws — logs errors and continues. */
  async execute(action: ActionDescriptor, ruleId: string): Promise<void> {
    try {
      switch (action.type) {
        case "publish":
          this.handlePublish(action, ruleId);
          break;
        case "toggle":
          await this.handleToggle(action, ruleId);
          break;
        case "device_action":
          await this.handleDeviceAction(action, ruleId);
          break;
        case "log":
          this.handleLog(action, ruleId);
          break;
        case "delay":
          await this.handleDelay(action, ruleId);
          break;
        case "webhook":
          await this.handleWebhook(action, ruleId);
          break;
        default:
          this.logger.warn(
            { ruleId, actionType: (action as { type: string }).type },
            `Unknown action type: ${(action as { type: string }).type}`,
          );
          return;
      }

      eventBus.emit(AUTOMATION_FIRED, {
        ruleId,
        actionType: action.type,
        target: action.target,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.logger.error(
        { ruleId, actionType: action.type, target: action.target, error: (err as Error).message },
        `Action execution failed for rule ${ruleId}`,
      );
    }
  }

  /** Execute a sequence of actions in order. Continues on individual failures. */
  async executeSequence(actions: ActionDescriptor[], ruleId: string): Promise<void> {
    for (const action of actions) {
      await this.execute(action, ruleId);
    }
  }

  private handlePublish(action: ActionDescriptor, ruleId: string): void {
    if (!this.mqttService.isConnected()) {
      this.logger.error(
        { ruleId, topic: action.target },
        "MQTT not connected, skipping publish action",
      );
      throw new Error("MQTT client not connected");
    }
    const payload = typeof action.params.payload === "string"
      ? action.params.payload
      : JSON.stringify(action.params.payload);
    this.mqttService.publish(action.target, payload);
  }

  private async handleToggle(action: ActionDescriptor, _ruleId: string): Promise<void> {
    await this.connectorManager.executeAction(action.target, {
      type: "toggle",
      deviceId: action.target,
      params: action.params,
    });
  }

  private async handleDeviceAction(action: ActionDescriptor, _ruleId: string): Promise<void> {
    const actionType = typeof action.params.actionType === "string"
      ? action.params.actionType
      : "unknown";
    await this.connectorManager.executeAction(action.target, {
      type: actionType,
      deviceId: action.target,
      params: action.params,
    });
  }

  private handleLog(action: ActionDescriptor, ruleId: string): void {
    const message = typeof action.params.message === "string"
      ? action.params.message
      : JSON.stringify(action.params.message);
    this.logger.info({ ruleId, message }, `Automation log: ${message}`);
  }

  private async handleDelay(action: ActionDescriptor, ruleId: string): Promise<void> {
    const duration = typeof action.params.duration === "number" ? action.params.duration : 0;
    if (duration <= 0) {
      this.logger.warn({ ruleId, duration }, "Delay with zero/negative duration, treating as no-op");
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, duration));
  }

  private async handleWebhook(action: ActionDescriptor, ruleId: string): Promise<void> {
    const method = typeof action.params.method === "string" ? action.params.method : "POST";
    const headers = (action.params.headers as Record<string, string>) ?? {};
    const body = action.params.body !== undefined ? String(action.params.body) : undefined;

    const response = await fetch(action.target, { method, headers, body });
    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status} ${response.statusText}`);
    }
  }
}
