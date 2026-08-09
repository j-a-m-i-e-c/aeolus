// src/api/routes/mqtt-command-profile.ts
// phase-1-runtime-foundations Task 6 — validation for the generic MQTT command
// profile write path. Pure and side-effect free so it is unit-testable and can
// sanitize on write (Req 8.9): only known fields are accepted, wildcards and
// unbounded/secret-bearing values are rejected.

import type { MqttCommandProfile } from "../../core/types.js";

export type ProfileValidation =
  | { ok: true; value: MqttCommandProfile | undefined }
  | { ok: false; error: string };

const MAX_TOPIC_LEN = 256;
const MAX_FIELD_LEN = 128;
const MAX_INDICATOR_VALUES = 32;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate and sanitize a submitted MQTT command profile.
 *
 * Returns a clean {@link MqttCommandProfile} built only from recognised fields
 * (unknown keys are dropped, never persisted), or `value: undefined` when the
 * submission carries no profile fields (a request to clear the profile).
 */
export function validateMqttCommandProfile(body: unknown): ProfileValidation {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Profile must be a JSON object" };
  }

  const out: MqttCommandProfile = {};

  if (body.qos !== undefined) {
    if (body.qos !== 0 && body.qos !== 1 && body.qos !== 2) {
      return { ok: false, error: "qos must be 0, 1, or 2" };
    }
    out.qos = body.qos;
  }

  if (body.acknowledgement !== undefined) {
    const ack = body.acknowledgement;
    if (!isPlainObject(ack)) {
      return { ok: false, error: "acknowledgement must be an object" };
    }
    if (typeof ack.supported !== "boolean") {
      return { ok: false, error: "acknowledgement.supported must be a boolean" };
    }
    const ackOut: NonNullable<MqttCommandProfile["acknowledgement"]> = { supported: ack.supported };

    if (ack.responseTopic !== undefined) {
      if (
        typeof ack.responseTopic !== "string" ||
        ack.responseTopic.length === 0 ||
        ack.responseTopic.length > MAX_TOPIC_LEN
      ) {
        return { ok: false, error: "acknowledgement.responseTopic must be a non-empty string (<=256 chars)" };
      }
      if (ack.responseTopic.includes("+") || ack.responseTopic.includes("#")) {
        return { ok: false, error: "acknowledgement.responseTopic must be a concrete publish topic, not a wildcard" };
      }
      ackOut.responseTopic = ack.responseTopic;
    }

    if (ack.ackIndicatorField !== undefined) {
      if (
        typeof ack.ackIndicatorField !== "string" ||
        ack.ackIndicatorField.length === 0 ||
        ack.ackIndicatorField.length > MAX_FIELD_LEN
      ) {
        return { ok: false, error: "acknowledgement.ackIndicatorField must be a non-empty string (<=128 chars)" };
      }
      ackOut.ackIndicatorField = ack.ackIndicatorField;
    }

    if (ack.ackIndicatorValues !== undefined) {
      if (!Array.isArray(ack.ackIndicatorValues) || ack.ackIndicatorValues.length > MAX_INDICATOR_VALUES) {
        return { ok: false, error: "acknowledgement.ackIndicatorValues must be an array of at most 32 strings" };
      }
      for (const v of ack.ackIndicatorValues) {
        if (typeof v !== "string" || v.length === 0 || v.length > MAX_FIELD_LEN) {
          return { ok: false, error: "each ackIndicatorValue must be a non-empty string (<=128 chars)" };
        }
      }
      ackOut.ackIndicatorValues = ack.ackIndicatorValues as string[];
    }

    out.acknowledgement = ackOut;
  }

  const isEmpty = out.qos === undefined && out.acknowledgement === undefined;
  return { ok: true, value: isEmpty ? undefined : out };
}
