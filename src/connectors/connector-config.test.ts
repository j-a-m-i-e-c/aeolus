// src/connectors/connector-config.test.ts — redaction, the password mask, validation.
import { describe, expect, it } from "vitest";
import type { ConnectorModule } from "./connector.interface.js";
import { ConnectorConfigError, PASSWORD_MASK, redactConfig, resolveConfigUpdate, resolveNewConfig } from "./connector-config.js";

const mod = {
  metadata: { id: "m", displayName: "M", icon: "plug", description: "", supportedDeviceTypes: [], requiresSetup: false },
  configSchema: [
    { id: "host", label: "Host", type: "text", required: true },
    { id: "apiKey", label: "Key", type: "password", required: true },
    { id: "token", label: "Token", type: "password", required: false },
  ],
  createConnector: () => { throw new Error("unused"); },
  validateConfig: (config: Record<string, unknown>) => (config.host === "bad" ? ["host is bad"] : []),
} as unknown as ConnectorModule;

const errorOf = (work: () => unknown): ConnectorConfigError => {
  try { work(); } catch (error) { if (error instanceof ConnectorConfigError) return error; throw error; }
  throw new Error("expected a ConnectorConfigError");
};

describe("redactConfig", () => {
  it("masks set password fields only, and leaves unset ones visible as unset", () => {
    expect(redactConfig({ host: "h", apiKey: "secret", token: "" }, mod)).toEqual({ host: "h", apiKey: PASSWORD_MASK, token: "" });
    expect(redactConfig({ apiKey: "secret" }, undefined)).toEqual({ apiKey: "secret" });
  });
});

describe("resolveNewConfig", () => {
  it("refuses the mask as a value for a new instance", () => {
    expect(errorOf(() => resolveNewConfig({ host: "h", apiKey: PASSWORD_MASK }, mod)).message).toMatch(/apiKey: the placeholder/);
  });

  it("checks required fields and then the module's own rules", () => {
    expect(errorOf(() => resolveNewConfig({ host: "h" }, mod)).message).toMatch(/Missing required fields: apiKey/);
    expect(errorOf(() => resolveNewConfig({ host: "bad", apiKey: "k" }, mod)).problems).toEqual(["host is bad"]);
    expect(resolveNewConfig({ host: "h", apiKey: "k" }, mod)).toEqual({ host: "h", apiKey: "k" });
  });

  it("does not treat the mask as special in a non-password field", () => {
    expect(resolveNewConfig({ host: PASSWORD_MASK, apiKey: "k" }, mod).host).toBe(PASSWORD_MASK);
  });
});

describe("resolveConfigUpdate", () => {
  const stored = { host: "h", apiKey: "real-secret" };

  it("keeps the stored secret when the mask is posted back", () => {
    expect(resolveConfigUpdate(stored, { host: "h2", apiKey: PASSWORD_MASK }, mod)).toEqual({ host: "h2", apiKey: "real-secret" });
  });

  it("replaces a secret with an explicit new value", () => {
    expect(resolveConfigUpdate(stored, { apiKey: "new-secret" }, mod).apiKey).toBe("new-secret");
  });

  it("refuses the mask when no secret is stored", () => {
    expect(errorOf(() => resolveConfigUpdate({ host: "h", apiKey: "k" }, { token: PASSWORD_MASK }, mod)).message).toMatch(/token: no secret is stored/);
    expect(errorOf(() => resolveConfigUpdate({ host: "h", apiKey: PASSWORD_MASK }, { apiKey: PASSWORD_MASK }, mod)).message).toMatch(/apiKey: no secret/);
  });

  it("clears an optional secret explicitly, but never a required one", () => {
    expect(resolveConfigUpdate({ ...stored, token: "t" }, { token: "" }, mod).token).toBe("");
    expect(errorOf(() => resolveConfigUpdate(stored, { apiKey: null }, mod)).message).toMatch(/Missing required fields: apiKey/);
  });

  it("validates the merged result and never mutates the stored config", () => {
    const before = { ...stored };
    expect(errorOf(() => resolveConfigUpdate(stored, { host: "bad", apiKey: PASSWORD_MASK }, mod)).problems).toEqual(["host is bad"]);
    expect(stored).toEqual(before);
  });

  it("never puts a secret in an error message", () => {
    const error = errorOf(() => resolveConfigUpdate(stored, { host: "bad", apiKey: PASSWORD_MASK }, mod));
    expect(error.message).not.toContain("real-secret");
  });
});
