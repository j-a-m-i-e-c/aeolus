// src/secrets/errors.ts — the one error that stops the backend because stored secrets
// cannot be used safely (H2). Its message names locations, key ids and commands,
// never a key, a passphrase or a decrypted value.

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsUnavailableError";
  }
}
