// src/connectors/connector-config.ts — connector configuration rules shared by the
// manager and the REST routes: redaction of password fields, what the redaction
// mask means when it is posted back, and validation before anything is persisted.
//
// The API never returns a stored password-field value; it returns PASSWORD_MASK.
// A form that edits an instance therefore posts the mask back for a secret the
// operator did not touch. The mask is recognised only for fields the module's
// schema declares as `password`, and only when a secret is already stored: then it
// means "keep the stored value". Anywhere else it is refused, so the placeholder can
// never be persisted over, or instead of, a real credential. A secret is replaced
// by posting a new value and cleared by posting "" or null; a required field cannot
// be cleared.

import type { ConnectorConfigSchema, ConnectorModule } from "./connector.interface.js";

/** What the API shows instead of a stored password-field value. */
export const PASSWORD_MASK = "********";

/** A configuration the connector or the schema refuses. Its message holds no secret. */
export class ConnectorConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "ConnectorConfigError";
  }
}

function passwordFields(schema: ConnectorConfigSchema): Set<string> {
  return new Set(schema.filter((field) => field.type === "password").map((field) => field.id));
}

function isStoredSecret(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value !== PASSWORD_MASK;
}

/** Replace every password-field value with the mask, as every API response must. */
export function redactConfig(config: Record<string, unknown>, mod: ConnectorModule | undefined): Record<string, unknown> {
  if (!mod) return { ...config };
  const secret = passwordFields(mod.configSchema);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    redacted[key] = secret.has(key) && value !== undefined && value !== null && value !== "" ? PASSWORD_MASK : value;
  }
  return redacted;
}

/** Required fields that are missing, null or empty. */
export function missingRequiredFields(config: Record<string, unknown>, schema: ConnectorConfigSchema): string[] {
  return schema
    .filter((field) => field.required)
    .filter((field) => config[field.id] === undefined || config[field.id] === null || config[field.id] === "")
    .map((field) => field.id);
}

/** Required fields, then the module's own checks. Throws ConnectorConfigError. */
export function assertValidConfig(config: Record<string, unknown>, mod: ConnectorModule): void {
  const problems: string[] = [];
  const missing = missingRequiredFields(config, mod.configSchema);
  if (missing.length > 0) problems.push(`Missing required fields: ${missing.join(", ")}`);
  if (problems.length === 0 && mod.validateConfig) problems.push(...mod.validateConfig(config));
  if (problems.length > 0) throw new ConnectorConfigError(problems);
}

/** A new instance's config: the mask has no stored secret to stand for, so it is refused. */
export function resolveNewConfig(config: Record<string, unknown>, mod: ConnectorModule): Record<string, unknown> {
  const masked = [...passwordFields(mod.configSchema)].filter((id) => config[id] === PASSWORD_MASK);
  if (masked.length > 0) {
    throw new ConnectorConfigError(masked.map((id) => `${id}: the placeholder ${PASSWORD_MASK} is not a value; enter the secret`));
  }
  const resolved = { ...config };
  assertValidConfig(resolved, mod);
  return resolved;
}

/**
 * Merge an update into the stored config. A password field posted as the mask keeps
 * the stored secret, or is refused when none is stored. The result is validated, and
 * nothing is persisted by this function.
 */
export function resolveConfigUpdate(
  stored: Record<string, unknown>,
  update: Record<string, unknown>,
  mod: ConnectorModule,
): Record<string, unknown> {
  const secret = passwordFields(mod.configSchema);
  const problems: string[] = [];
  const resolved: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(update)) {
    if (secret.has(key) && value === PASSWORD_MASK) {
      if (isStoredSecret(stored[key])) continue;
      problems.push(`${key}: no secret is stored, so the placeholder ${PASSWORD_MASK} cannot keep one; enter the secret`);
      continue;
    }
    resolved[key] = value;
  }
  if (problems.length > 0) throw new ConnectorConfigError(problems);
  assertValidConfig(resolved, mod);
  return resolved;
}
