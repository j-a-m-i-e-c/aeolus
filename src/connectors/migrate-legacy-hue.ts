// src/connectors/migrate-legacy-hue.ts — One-time migration of legacy hue-credentials.json into ConnectorStore

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { ConnectorStore } from "./connector-store.js";
import type { ConnectorRecord } from "./connector.interface.js";
import logger from "../logger.js";

/**
 * Check for a legacy `hue-credentials.json` file next to the database.
 * If found, import bridgeIp and apiKey into the ConnectorStore as an
 * enabled Hue connector record, then rename the file to
 * `hue-credentials.json.migrated` so it is not re-imported on next startup.
 */
export function migrateLegacyHueCredentials(store: ConnectorStore): void {
  const credentialsPath = path.join(
    path.dirname(config.dbPath),
    "hue-credentials.json",
  );

  if (!fs.existsSync(credentialsPath)) {
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(credentialsPath, "utf-8");
  } catch (err) {
    logger.warn(
      { path: credentialsPath, error: (err as Error).message },
      "Failed to read legacy Hue credentials file — skipping migration",
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(
      { path: credentialsPath },
      "Legacy Hue credentials file contains malformed JSON — skipping migration",
    );
    return;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).bridgeIp !== "string" ||
    typeof (parsed as Record<string, unknown>).apiKey !== "string"
  ) {
    logger.warn(
      { path: credentialsPath },
      "Legacy Hue credentials file missing bridgeIp or apiKey — skipping migration",
    );
    return;
  }

  const { bridgeIp, apiKey } = parsed as { bridgeIp: string; apiKey: string };

  const now = Date.now();
  const record: ConnectorRecord = {
    id: randomUUID(),
    connectorType: "hue",
    enabled: true,
    config: { bridgeIp, apiKey },
    createdAt: now,
    updatedAt: now,
  };

  store.save(record);

  // Rename so we don't re-migrate on next startup
  try {
    fs.renameSync(credentialsPath, `${credentialsPath}.migrated`);
  } catch (err) {
    logger.warn(
      { path: credentialsPath, error: (err as Error).message },
      "Failed to rename legacy Hue credentials file after migration",
    );
  }

  logger.info(
    { instanceId: record.id, bridgeIp },
    "Migrated legacy Hue credentials into ConnectorStore",
  );
}
