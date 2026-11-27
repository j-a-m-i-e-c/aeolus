// src/connectors/bundled.ts — the connector modules shipped with Aeolus, in one list so
// the backend's registry and the offline `aeolus-secrets` CLI agree on which config
// fields are secrets (the schema's `password` fields).

import type { ConnectorModule } from "./connector.interface.js";
import * as hueModule from "./hue/index.js";
import * as kasaModule from "./kasa/index.js";
import * as aeolusRemoteModule from "./aeolus-remote/index.js";
import type { SecretFieldLookup } from "../secrets/secret-store.js";

export const BUNDLED_CONNECTOR_MODULES: readonly ConnectorModule[] = [hueModule, kasaModule, aeolusRemoteModule];

/** The `password` fields of each module's schema, by connector type id. */
export function secretFieldLookup(modules: readonly ConnectorModule[]): SecretFieldLookup {
  const fields = new Map(modules.map((mod) => [mod.metadata.id, mod.configSchema.filter((field) => field.type === "password").map((field) => field.id)]));
  return (connectorType) => fields.get(connectorType);
}
