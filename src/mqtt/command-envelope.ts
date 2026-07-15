// src/mqtt/command-envelope.ts — Correlated command envelope for MQTT dispatch

import { randomUUID } from "node:crypto";

/**
 * A dispatched command together with its correlation id and response topic.
 *
 * The correlation id and response topic are mirrored in BOTH the MQTT 5 message
 * properties (Correlation Data / Response Topic) and the JSON payload, so that
 * firmware reading either mechanism can reply on the response topic with the
 * matching correlation id (Req 10.1).
 */
export interface CommandEnvelope {
  correlationId: string;
  responseTopic: string;
  /** The device command payload, mirrored with the correlation fields. */
  payload: Record<string, unknown> & { correlationId: string; responseTopic: string };
}

/**
 * Build a {@link CommandEnvelope} for a command payload.
 *
 * @param basePayload   The device command parameters to send.
 * @param responseTopic The topic the device should reply on (e.g. "aeolus/acks/<device>").
 * @param correlationId Optional explicit id; a UUID is generated when omitted.
 */
export function buildCommandEnvelope(
  basePayload: Record<string, unknown>,
  responseTopic: string,
  correlationId: string = randomUUID(),
): CommandEnvelope {
  return {
    correlationId,
    responseTopic,
    payload: { ...basePayload, correlationId, responseTopic },
  };
}
