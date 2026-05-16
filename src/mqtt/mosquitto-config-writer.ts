// src/mqtt/mosquitto-config-writer.ts — Atomic Mosquitto configuration file writer

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface MosquittoConfigWriterOptions {
  configPath: string;
}

/**
 * Writes Mosquitto broker configuration files atomically.
 * Uses write-to-temp-then-rename to prevent partial reads by the broker during reload.
 */
export class MosquittoConfigWriter {
  private readonly configPath: string;

  constructor(options: MosquittoConfigWriterOptions) {
    this.configPath = options.configPath;
  }

  /**
   * Write config for open mode: allow_anonymous true, no password_file directive.
   * Satisfies Requirements 1.5, 2.1, 2.2.
   */
  writeOpenConfig(): void {
    const content = [
      "listener 1883",
      "allow_anonymous true",
      "persistence true",
      "persistence_location /mosquitto/data/",
      "log_dest stdout",
      "",
    ].join("\n");

    this.atomicWrite(content);
  }

  /**
   * Write config for authenticated mode: allow_anonymous false with password_file directive.
   * Used for both shared_password and per_device security levels.
   * Satisfies Requirements 3.3, 4.1.
   */
  writeAuthenticatedConfig(passwordFilePath: string): void {
    const content = [
      "listener 1883",
      "allow_anonymous false",
      `password_file ${passwordFilePath}`,
      "persistence true",
      "persistence_location /mosquitto/data/",
      "log_dest stdout",
      "",
    ].join("\n");

    this.atomicWrite(content);
  }

  /**
   * Write content atomically: write to a temp file in the same directory,
   * then rename to the target path. This prevents partial reads by the broker.
   * Satisfies Requirement 5.3.
   */
  private atomicWrite(content: string): void {
    const directory = path.dirname(this.configPath);
    const tempPath = path.join(directory, `.mosquitto.conf.tmp.${crypto.randomBytes(4).toString("hex")}`);

    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, this.configPath);
  }
}
