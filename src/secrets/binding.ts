// src/secrets/binding.ts — which keyring a database belongs to, and what startup may do.
//
// The database records the keyring it is bound to in system_settings.secrets_binding:
// the installation id and, per key, its id and fingerprint (never the key). That is
// how a fresh installation (no binding, nothing encrypted: create a keyring) is told
// apart from an existing installation whose keyring is missing (refuse to start:
// generating a replacement would lose every encrypted secret).

import type { Database as DatabaseType } from "better-sqlite3";
import { collectSecretValues, summariseEnvelopes } from "./locations.js";
import type { SecretFieldLookup } from "./secret-store.js";
import { keyById, keyFingerprint, type Keyring } from "./keyring.js";

export const BINDING_SETTING = "secrets_binding";

export interface SecretsBinding {
  installationId: string;
  keys: Array<{ id: string; fingerprint: string }>;
}

export class SecretsBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsBindingError";
  }
}

export function bindingFor(ring: Keyring): SecretsBinding {
  return {
    installationId: ring.installationId,
    keys: ring.keys.map((entry) => {
      const key = keyById(ring, entry.id)!;
      return { id: entry.id, fingerprint: keyFingerprint(key) };
    }),
  };
}

export function readBinding(db: DatabaseType): SecretsBinding | null {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(BINDING_SETTING) as { value: string } | undefined;
  if (!row) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    throw new SecretsBindingError("The stored secrets binding is not valid JSON; refusing to guess which keyring this database needs");
  }
  const binding = value as SecretsBinding;
  if (typeof binding?.installationId !== "string" || !Array.isArray(binding.keys) || binding.keys.length === 0
    || binding.keys.some((key) => typeof key?.id !== "string" || typeof key?.fingerprint !== "string")) {
    throw new SecretsBindingError("The stored secrets binding is malformed; refusing to guess which keyring this database needs");
  }
  return binding;
}

export function writeBinding(db: DatabaseType, binding: SecretsBinding): void {
  db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(BINDING_SETTING, JSON.stringify(binding));
}

/** Envelopes in the secret locations, and the key ids they use. Read-only. */
export function scanEnvelopes(db: DatabaseType, lookup: SecretFieldLookup): { count: number; keyIds: string[] } {
  return summariseEnvelopes(collectSecretValues(db, lookup));
}

export type BootstrapDecision =
  | { action: "create-keyring-and-bind" }
  | { action: "bind-existing-keyring" }
  | { action: "ready" }
  | { action: "refuse"; reason: string };

/**
 * The decision table (H2 design, point 2, with the H2b restore rule). `keyring` is
 * null when the file is absent. Only a database with no binding and no envelopes may
 * get a new keyring, and only a keyring that has never been bound may be bound to a
 * database without asking: a bound keyring meeting an unbound database means an older
 * database was restored (or a different one supplied), which needs `aeolus-secrets adopt`.
 */
export function decideBootstrap(binding: SecretsBinding | null, envelopes: { count: number; keyIds: string[] }, keyring: Keyring | null): BootstrapDecision {
  if (!binding) {
    if (envelopes.count > 0) {
      return { action: "refuse", reason: "This database holds encrypted secrets but records no keyring binding. It may have been edited or partly restored; refusing to start rather than guess." };
    }
    if (!keyring) return { action: "create-keyring-and-bind" };
    if (keyring.boundAt !== undefined) {
      return {
        action: "refuse",
        reason: `The keyring has been bound to a database of installation ${keyring.installationId} since ${new Date(keyring.boundAt).toISOString()}, but this database records no binding. It is probably a backup from before secrets were encrypted, restored over a bound installation, or a different database. Nothing was changed. If this database is the one you intend to run, bind it explicitly with the backend stopped: aeolus-secrets adopt --db <path>`,
      };
    }
    return { action: "bind-existing-keyring" };
  }
  if (!keyring) {
    return {
      action: "refuse",
      reason: "This database is bound to a keyring that is missing. Restore the keyring file (or a keyring backup with `aeolus-secrets restore`). A new keyring is never generated for an existing installation; if the keyring is truly lost, see the recovery procedure.",
    };
  }
  if (keyring.installationId !== binding.installationId) {
    return { action: "refuse", reason: "The keyring belongs to a different installation than this database. Restore this installation's keyring." };
  }
  const missing: string[] = [];
  for (const expected of binding.keys) {
    const key = keyById(keyring, expected.id);
    if (!key || keyFingerprint(key) !== expected.fingerprint) missing.push(expected.id);
  }
  for (const id of envelopes.keyIds) {
    if (!keyById(keyring, id) && !missing.includes(id)) missing.push(id);
  }
  if (missing.length > 0) {
    return { action: "refuse", reason: `The keyring does not hold the key(s) this database needs, or holds different ones: ${missing.join(", ")}. Restore a keyring backup that contains them.` };
  }
  return { action: "ready" };
}