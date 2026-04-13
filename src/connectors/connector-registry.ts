// src/connectors/connector-registry.ts — Auto-discovery and manual registration of connector modules

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";
import type {
  ConnectorModule,
  ConnectorMetadata,
  ConnectorConfigSchema,
} from "./connector.interface.js";

/**
 * Validates that a module export has the required ConnectorModule shape:
 * - `metadata` object with a string `id`
 * - `configSchema` array
 * - `createConnector` function
 */
function isValidConnectorModule(mod: unknown): mod is ConnectorModule {
  if (mod == null || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;

  if (
    m.metadata == null ||
    typeof m.metadata !== "object" ||
    typeof (m.metadata as Record<string, unknown>).id !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(m.configSchema)) return false;

  if (typeof m.createConnector !== "function") return false;

  return true;
}

/**
 * Registry of available connector modules.
 *
 * Supports two registration modes:
 * 1. **Manual** — call `register(module)` from application wiring code (works in bundled builds)
 * 2. **Auto-discovery** — call `discoverFromDirectory(dir)` to scan a directory for connector
 *    subdirectories at development/test time
 *
 * Once registered (by either method), modules are queryable via `listAvailable()` and `getModule()`.
 */
export class ConnectorRegistry {
  /** Map of connector type id → ConnectorModule */
  private modules = new Map<string, ConnectorModule>();

  /**
   * Manually register a connector module.
   *
   * Used by the application entry point (`index.ts`) to register known connectors
   * in bundled environments where dynamic filesystem scanning is not possible.
   *
   * @param mod - A valid ConnectorModule with metadata, configSchema, and createConnector.
   */
  register(mod: ConnectorModule): void {
    if (!isValidConnectorModule(mod)) {
      logger.warn(
        { module: mod },
        "Attempted to register invalid connector module — skipping",
      );
      return;
    }

    const id = mod.metadata.id;
    if (this.modules.has(id)) {
      logger.warn(
        { connectorType: id },
        "Connector type already registered — overwriting",
      );
    }

    this.modules.set(id, mod);
    logger.info({ connectorType: id }, "Registered connector module");
  }

  /**
   * Scan a directory for connector subdirectories and dynamically import each one.
   *
   * Skips entries that are:
   * - Not directories
   * - Named `_template`
   * - Starting with `connector` (e.g. `connector.interface.ts`, `connector-registry.ts`)
   * - Named `README.md`
   *
   * For each valid subdirectory, attempts to import `index.ts` (or `index.js`).
   * Validates the module shape and registers valid modules.
   *
   * @param dir - Absolute path to the connectors directory to scan.
   */
  async discoverFromDirectory(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.error({ dir, err }, "Failed to read connectors directory");
      return;
    }

    for (const entry of entries) {
      // Skip non-directories
      if (!entry.isDirectory()) continue;

      // Skip _template directory
      if (entry.name === "_template") continue;

      // Skip directories starting with "connector"
      if (entry.name.startsWith("connector")) continue;

      const subdir = path.join(dir, entry.name);

      // Try importing index.ts first, then index.js
      let mod: unknown;
      try {
        const indexTs = path.join(subdir, "index.ts");
        const indexJs = path.join(subdir, "index.js");

        if (fs.existsSync(indexTs)) {
          mod = await import(indexTs);
        } else if (fs.existsSync(indexJs)) {
          mod = await import(indexJs);
        } else {
          logger.warn(
            { dir: entry.name },
            "Connector subdirectory has no index.ts or index.js — skipping",
          );
          continue;
        }
      } catch (err) {
        logger.warn(
          { dir: entry.name, err },
          "Failed to import connector module — skipping",
        );
        continue;
      }

      if (!isValidConnectorModule(mod)) {
        // Log which exports are missing for developer guidance
        const m = (mod ?? {}) as Record<string, unknown>;
        const missing: string[] = [];
        if (!m.metadata || typeof m.metadata !== "object") missing.push("metadata");
        if (!Array.isArray(m.configSchema)) missing.push("configSchema");
        if (typeof m.createConnector !== "function") missing.push("createConnector");

        logger.warn(
          { dir: entry.name, missing },
          "Connector module missing required exports — skipping",
        );
        continue;
      }

      this.register(mod);
    }
  }

  /**
   * Convenience wrapper that resolves the connectors directory relative to this file
   * and calls `discoverFromDirectory`.
   */
  async discover(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    await this.discoverFromDirectory(__dirname);
  }

  /**
   * Return all registered connector types with their metadata and config schemas.
   */
  listAvailable(): Array<{
    metadata: ConnectorMetadata;
    configSchema: ConnectorConfigSchema;
  }> {
    return Array.from(this.modules.values()).map((mod) => ({
      metadata: mod.metadata,
      configSchema: mod.configSchema,
    }));
  }

  /**
   * Get a specific connector module by its metadata id.
   *
   * @param connectorType - The unique connector type identifier (e.g. "hue", "kasa").
   * @returns The ConnectorModule if found, or `undefined`.
   */
  getModule(connectorType: string): ConnectorModule | undefined {
    return this.modules.get(connectorType);
  }
}
