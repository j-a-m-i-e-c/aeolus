// src/connectors/aeolus-remote/index.ts — the Aeolus-to-Aeolus connector (ADR-0027,
// Project APIs Phase 5): one instance reads one published, granted Project API route
// of another installation and exposes it as one read-only remote observation.
//
// Not federation: no remote commands, no event delivery, no peer discovery and no
// shared users. The remote installation stays authoritative for its own data.

import type { Connector, ConnectorConfigSchema, ConnectorContext, ConnectorMetadata } from "../connector.interface.js";
import { AeolusRemoteConnector, CONNECTOR_ID } from "./connector.js";
import { MAX_RESPONSE_KIB, POLL_SECONDS, STALE_AFTER_SECONDS, parseRemoteConfig } from "./config.js";

export const metadata: ConnectorMetadata = {
  id: CONNECTOR_ID,
  displayName: "Aeolus Remote",
  icon: "network",
  description: "Reads one published Project API route of another Aeolus installation as a read-only observation",
  supportedDeviceTypes: ["sensor"],
  requiresSetup: false,
  multiInstance: true,
};

export const configSchema: ConnectorConfigSchema = [
  {
    id: "baseUrl",
    label: "Remote installation URL",
    type: "text",
    required: true,
    placeholder: "https://aeolus-a.lan:3001",
    helpText: "Origin of the other installation's backend: scheme, host and port only. HTTPS is verified against this host name.",
  },
  {
    id: "endpointPath",
    label: "Endpoint path",
    type: "text",
    required: true,
    placeholder: "/api/exposed/v1/site-a/conditions/summary",
    helpText: "The published route to read, as shown in the remote's Endpoints view. No query string.",
  },
  {
    id: "apiKey",
    label: "API key",
    type: "password",
    required: true,
    helpText: "The key the remote issued for this installation, granted to this route only. Once saved it is never shown again; leave it unchanged to keep it.",
  },
  {
    id: "allowPlaintextHttp",
    label: "Allow plaintext HTTP on a trusted LAN",
    type: "boolean",
    required: false,
    default: false,
    helpText: "Only for a trusted LAN or VPN: over plain HTTP the key and readings cross the network unencrypted. HTTPS is never downgraded.",
  },
  {
    id: "pollIntervalSeconds",
    label: "Poll interval (seconds)",
    type: "number",
    required: false,
    default: POLL_SECONDS.default,
    helpText: `From ${POLL_SECONDS.min} to ${POLL_SECONDS.max}. Failures back off to at most four intervals or 15 minutes.`,
  },
  {
    id: "staleAfterSeconds",
    label: "Stale after (seconds)",
    type: "number",
    required: false,
    default: STALE_AFTER_SECONDS.default,
    helpText: `A reading observed longer ago than this is stale even when the fetch succeeds. From ${STALE_AFTER_SECONDS.min}, and at least the poll interval.`,
  },
  {
    id: "sourceTimeField",
    label: "Source time field",
    type: "text",
    required: false,
    placeholder: "observedAt",
    helpText: "Field in the response holding when the remote observed the reading: Unix milliseconds or ISO 8601 with a time zone. The HTTP Date header is never used as the source time.",
  },
  {
    id: "requireSourceTime",
    label: "Require a source time",
    type: "boolean",
    required: false,
    default: false,
    helpText: "Mark a reading stale when it has no valid source time.",
  },
  {
    id: "maxResponseKiB",
    label: "Maximum response size (KiB)",
    type: "number",
    required: false,
    default: MAX_RESPONSE_KIB.default,
    helpText: `From ${MAX_RESPONSE_KIB.min} to ${MAX_RESPONSE_KIB.max}. A larger response is refused.`,
  },
  {
    id: "displayName",
    label: "Device name",
    type: "text",
    required: false,
    placeholder: "Remote site-a",
  },
];

/** Problems with a config, before anything is saved. Never includes the key. */
export function validateConfig(config: Record<string, unknown>): string[] {
  const parsed = parseRemoteConfig(config);
  return parsed.ok ? [] : parsed.problems;
}

export function createConnector(config: Record<string, unknown>, context?: ConnectorContext): Connector {
  if (!context?.instanceId) throw new Error("aeolus-remote needs its instance id for a stable device id");
  return new AeolusRemoteConnector(config, context.instanceId);
}
