// src/mqtt/mosquitto-reloader.ts — Pluggable, deployment-aware Mosquitto reload.
//
// Mosquitto re-reads its config and password file on SIGHUP; it does not watch
// them for changes. After the backend rewrites those files it must therefore
// trigger a reload. How that reload reaches the broker depends entirely on the
// deployment, so the mechanism is selected by MQTT_RELOAD_STRATEGY:
//
//   none    (default) — the backend does nothing. Used when a co-located
//                       sidecar watches the shared config volume and signals
//                       the broker itself, so the backend needs no privileges
//                       over the broker (the recommended Compose setup).
//   signal            — send SIGHUP to a broker PID the backend can see
//                       (shared PID namespace / same host). PID comes from
//                       MQTT_RELOAD_PID or MQTT_RELOAD_PID_FILE.
//   docker            — `docker kill --signal=SIGHUP <container>` with a
//                       container restart fallback. Requires the Docker socket;
//                       kept for backward compatibility, not recommended.
//   command           — run an arbitrary MQTT_RELOAD_COMMAND.
//
// A reload failure is never fatal: files are already written, so the broker
// will pick them up on its next start even if the live reload did not land.

import { execSync } from "node:child_process";
import fs from "node:fs";
import logger from "../logger.js";

export type ReloadStrategy = "none" | "signal" | "docker" | "command";

const EXEC_TIMEOUT_MS = 5000;
const DEFAULT_CONTAINER = "aeolus-mosquitto";

export interface MosquittoReloaderOptions {
  strategy?: ReloadStrategy;
  /** Container name for the `docker` strategy. */
  container?: string;
  /** Explicit PID for the `signal` strategy. */
  pid?: number;
  /** Path to a file containing the broker PID, for the `signal` strategy. */
  pidFile?: string;
  /** Shell command for the `command` strategy. */
  command?: string;
}

function readEnvStrategy(): ReloadStrategy {
  const raw = (process.env.MQTT_RELOAD_STRATEGY ?? "none").trim().toLowerCase();
  if (raw === "signal" || raw === "docker" || raw === "command" || raw === "none") {
    return raw;
  }
  logger.warn({ strategy: raw }, "Unknown MQTT_RELOAD_STRATEGY, defaulting to 'none'");
  return "none";
}

/**
 * MosquittoReloader signals the broker to reload its configuration and password
 * file using the strategy configured for the deployment.
 */
export class MosquittoReloader {
  private readonly strategy: ReloadStrategy;
  private readonly container: string;
  private readonly explicitPid?: number;
  private readonly pidFile?: string;
  private readonly command?: string;

  constructor(options: MosquittoReloaderOptions = {}) {
    this.strategy = options.strategy ?? readEnvStrategy();
    this.container = options.container ?? process.env.MQTT_RELOAD_CONTAINER ?? DEFAULT_CONTAINER;
    this.explicitPid = options.pid ?? parseOptionalInt(process.env.MQTT_RELOAD_PID);
    this.pidFile = options.pidFile ?? process.env.MQTT_RELOAD_PID_FILE;
    this.command = options.command ?? process.env.MQTT_RELOAD_COMMAND;
  }

  /** The active reload strategy (useful for logging/diagnostics). */
  getStrategy(): ReloadStrategy {
    return this.strategy;
  }

  /**
   * Reload the broker. Returns true when the reload was triggered (or when the
   * strategy is `none`, which intentionally delegates reloading elsewhere).
   */
  async reload(): Promise<boolean> {
    switch (this.strategy) {
      case "none":
        logger.debug("Reload strategy 'none' — relying on external watcher to reload the broker");
        return true;
      case "signal":
        return this.reloadBySignal();
      case "docker":
        return this.reloadByDocker();
      case "command":
        return this.reloadByCommand();
      default:
        return false;
    }
  }

  private reloadBySignal(): boolean {
    const pid = this.resolvePid();
    if (pid === undefined) {
      logger.error("Reload strategy 'signal' requires MQTT_RELOAD_PID or MQTT_RELOAD_PID_FILE");
      return false;
    }
    try {
      process.kill(pid, "SIGHUP");
      logger.info({ pid }, "Sent SIGHUP to Mosquitto process");
      return true;
    } catch (error) {
      logger.error({ pid, error: String(error) }, "Failed to send SIGHUP to Mosquitto process");
      return false;
    }
  }

  private resolvePid(): number | undefined {
    if (this.explicitPid !== undefined) return this.explicitPid;
    if (this.pidFile) {
      try {
        const contents = fs.readFileSync(this.pidFile, "utf-8").trim();
        const pid = Number.parseInt(contents, 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
        logger.error({ pidFile: this.pidFile, contents }, "PID file did not contain a valid PID");
      } catch (error) {
        logger.error({ pidFile: this.pidFile, error: String(error) }, "Failed to read PID file");
      }
    }
    return undefined;
  }

  private reloadByDocker(): boolean {
    if (this.runQuietly(`docker kill --signal=SIGHUP ${this.container}`)) {
      logger.info({ container: this.container }, "Sent SIGHUP to Mosquitto container");
      return true;
    }
    logger.warn("SIGHUP via docker failed, attempting container restart as fallback");
    if (this.runQuietly(`docker restart ${this.container}`)) {
      logger.info({ container: this.container }, "Restarted Mosquitto container (fallback reload)");
      return true;
    }
    logger.error(
      { container: this.container },
      "Failed to reload Mosquitto: both SIGHUP and restart failed",
    );
    return false;
  }

  private reloadByCommand(): boolean {
    if (!this.command) {
      logger.error("Reload strategy 'command' requires MQTT_RELOAD_COMMAND");
      return false;
    }
    if (this.runQuietly(this.command)) {
      logger.info("Ran custom Mosquitto reload command");
      return true;
    }
    logger.error("Custom Mosquitto reload command failed");
    return false;
  }

  private runQuietly(command: string): boolean {
    try {
      execSync(command, { timeout: EXEC_TIMEOUT_MS, stdio: "pipe" });
      return true;
    } catch (error) {
      logger.warn({ command, error: String(error) }, "Reload command failed");
      return false;
    }
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
