// src/simulator/runtime.ts
// phase-2-mqtt-simulator — the simulator runtime.
//
// Owns the MQTT client, the device registry and the command router. It holds NO
// reference to any Aeolus backend service, store or database (Req 1.3, 1.4).
// Scenario loading (device registration + stimulus routing) is layered on in
// later tasks; the runtime already routes command-topic messages through the
// generic-MQTT command wire contract and republishes coherent state on every
// (re)connect (Req 6.3).

import type { IPublishPacket } from "mqtt";
import type { Logger } from "pino";
import type { SimulatorConfig } from "./config.js";
import { SimulatorMqttClient } from "./mqtt-client.js";
import { SimulatorDeviceRegistry } from "./device-registry.js";
import { SimulatorCommandRouter } from "./command-router.js";
import { ScenarioManager } from "./scenario-manager.js";
import { FaultController } from "./fault-controller.js";
import { TimerBudget } from "./timer-budget.js";
import { createScenario } from "./scenarios/index.js";
import type { SimulatorScenario } from "./types.js";

export class SimulatorRuntime {
  private readonly config: SimulatorConfig;
  private readonly logger: Logger;
  private readonly client: SimulatorMqttClient;
  private readonly registry: SimulatorDeviceRegistry;
  private readonly commandRouter: SimulatorCommandRouter;
  private readonly scenarioManager: ScenarioManager;
  private readonly faults: FaultController;
  private readonly timerBudget: TimerBudget;

  constructor(config: SimulatorConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.client = new SimulatorMqttClient({
      brokerUrl: config.brokerUrl,
      clientId: config.clientId,
      ...(config.username !== undefined ? { username: config.username } : {}),
      ...(config.password !== undefined ? { password: config.password } : {}),
      baseRetryDelayMs: config.baseRetryDelayMs,
      maxBackoffMs: config.maxBackoffMs,
      logger,
    });

    this.timerBudget = new TimerBudget(config.maxPendingTimers);
    this.faults = new FaultController({ maxDelayMs: config.maxDelayMs, logger });

    this.registry = new SimulatorDeviceRegistry({
      publish: (topic, payload, options) => this.safePublish(topic, payload, { retain: options.retain }),
      logger,
      maxDelayMs: config.maxDelayMs,
      timerBudget: this.timerBudget,
    });

    this.commandRouter = new SimulatorCommandRouter({
      registry: this.registry,
      publish: (topic, payload, options) => this.safePublish(topic, payload, options),
      logger,
      maxDelayMs: config.maxDelayMs,
      faults: this.faults,
      timerBudget: this.timerBudget,
      maxQueueDepth: config.maxCommandQueueDepth,
    });

    this.scenarioManager = new ScenarioManager({ registry: this.registry, faults: this.faults, logger });
  }

  /** The device registry, so scenario loading can register devices. */
  getRegistry(): SimulatorDeviceRegistry {
    return this.registry;
  }

  /**
   * Load a scenario before {@link start}: registers its devices and its declared
   * Automation Event stimulus handlers.
   */
  loadScenario(scenario: SimulatorScenario): void {
    this.scenarioManager.load(scenario);
  }

  /** Expose the MQTT client for later tasks (Automation Event ingestion). */
  getClient(): SimulatorMqttClient {
    return this.client;
  }

  /** Load the scenarios named in the configuration (AEOLUS_SIMULATOR_SCENARIOS). */
  loadConfiguredScenarios(): void {
    for (const key of this.config.scenarios) {
      const scenario = createScenario(key);
      if (!scenario) {
        this.logger.warn({ scenario: key }, "Unknown simulator scenario; skipping");
        continue;
      }
      this.loadScenario(scenario);
      this.logger.info({ scenario: key, devices: scenario.devices.length }, "Loaded simulator scenario");
    }
  }

  /** Connect to the broker and begin routing command-topic messages. */
  async start(): Promise<void> {
    this.loadConfiguredScenarios();
    this.client.setMessageHandler((topic, payload, packet) => this.routeMessage(topic, payload, packet));
    this.client.setConnectListener(() => this.onConnect());

    // Subscribe to every command-capable device's command topic. These are
    // remembered by the client and restored automatically after a reconnect.
    for (const topic of this.registry.commandTopicList()) {
      await this.client.subscribe(topic);
    }

    // Subscribe to the reserved Automation Event namespace only when a loaded
    // scenario actually declares a stimulus.
    if (this.scenarioManager.hasDeclaredStimuli()) {
      await this.client.subscribe(this.scenarioManager.eventTopicFilter());
    }

    await this.client.connect();
    this.logger.info(
      { scenarios: this.config.scenarios, devices: this.registry.list().length },
      "Simulator runtime started",
    );
  }

  /** Stop the runtime: dispose models/routers, release timers and disconnect. */
  async stop(): Promise<void> {
    this.commandRouter.dispose();
    await this.scenarioManager.dispose();
    await this.registry.dispose();
    await this.client.disconnect();
    this.logger.info("Simulator runtime stopped");
  }

  private onConnect(): void {
    // Republish coherent current state so a fresh or reconnected broker sees it.
    this.registry.publishAll(true);
  }

  private routeMessage(topic: string, payload: Buffer, packet?: IPublishPacket): void {
    if (this.registry.getByCommandTopic(topic)) {
      void this.commandRouter.handleCommand(topic, payload, packet);
      return;
    }
    if (ScenarioManager.isEventTopic(topic)) {
      void this.scenarioManager.handleAutomationEvent(topic, payload, packet);
      return;
    }
    this.logger.debug({ topic }, "Simulator received an unrouted message");
  }

  /** Publish that tolerates a transient disconnect rather than throwing. */
  private safePublish(topic: string, payload: string, options: { retain?: boolean; qos?: 0 | 1 | 2; correlationData?: Buffer; responseTopic?: string }): void {
    try {
      this.client.publish(topic, payload, options);
    } catch (err) {
      this.logger.debug({ topic, error: (err as Error).message }, "Dropped publish (client not connected)");
    }
  }
}
