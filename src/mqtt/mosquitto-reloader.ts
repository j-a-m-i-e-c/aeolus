// Mosquitto Reloader — Handles signaling the Mosquitto container to reload its configuration
// Implements: reload() with SIGHUP primary and container restart fallback
// Requirements: 7.1, 7.2, 7.3, 7.4

import { execSync } from "node:child_process";
import logger from "../logger.js";

const CONTAINER_NAME = "aeolus-mosquitto";
const EXEC_TIMEOUT_MS = 5000;

/**
 * MosquittoReloader handles signaling the Mosquitto broker container
 * to reload its configuration. Uses SIGHUP as the primary mechanism
 * with a full container restart as fallback.
 */
export class MosquittoReloader {
  /**
   * Reload the Mosquitto broker configuration.
   *
   * First attempts to send SIGHUP to the container (hot reload).
   * If that fails, falls back to a full container restart.
   * Returns true if either method succeeds, false if both fail.
   */
  async reload(): Promise<boolean> {
    // Attempt 1: SIGHUP signal for hot config reload
    if (this.sendSighup()) {
      return true;
    }

    // Attempt 2: Full container restart as fallback
    logger.warn("SIGHUP failed, attempting container restart as fallback");
    if (this.restartContainer()) {
      return true;
    }

    // Both methods failed
    logger.error(
      { container: CONTAINER_NAME },
      "Failed to reload Mosquitto broker: both SIGHUP and restart failed"
    );
    return false;
  }

  /**
   * Send SIGHUP to the Mosquitto container to trigger a config reload.
   */
  private sendSighup(): boolean {
    try {
      execSync(`docker kill --signal=SIGHUP ${CONTAINER_NAME}`, {
        timeout: EXEC_TIMEOUT_MS,
        stdio: "pipe",
      });
      logger.info({ container: CONTAINER_NAME }, "Sent SIGHUP to Mosquitto container");
      return true;
    } catch (error) {
      logger.warn(
        { container: CONTAINER_NAME, error: String(error) },
        "Failed to send SIGHUP to Mosquitto container"
      );
      return false;
    }
  }

  /**
   * Restart the Mosquitto container as a fallback reload mechanism.
   */
  private restartContainer(): boolean {
    try {
      execSync(`docker restart ${CONTAINER_NAME}`, {
        timeout: EXEC_TIMEOUT_MS,
        stdio: "pipe",
      });
      logger.info({ container: CONTAINER_NAME }, "Restarted Mosquitto container (fallback reload)");
      return true;
    } catch (error) {
      logger.error(
        { container: CONTAINER_NAME, error: String(error) },
        "Failed to restart Mosquitto container"
      );
      return false;
    }
  }
}
