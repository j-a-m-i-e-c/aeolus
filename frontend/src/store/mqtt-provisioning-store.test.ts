// frontend/src/store/mqtt-provisioning-store.test.ts — Unit tests for the MQTT provisioning store

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { useMqttProvisioningStore } from "./mqtt-provisioning-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useMqttProvisioningStore.getState();

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("mqtt-provisioning-store", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    useMqttProvisioningStore.setState({
      level: "open", sharedCredential: null, credentials: [], loading: false,
    });
  });

  it("fetchStatus loads the level and shared credential", async () => {
    mockAuthFetch.mockResolvedValue(jsonOk({
      level: "shared_password",
      sharedCredential: { username: "u", password: "p" },
      backendConnected: true,
    }));

    await s().fetchStatus();

    expect(s().level).toBe("shared_password");
    expect(s().sharedCredential).toEqual({ username: "u", password: "p" });
    expect(s().loading).toBe(false);
  });

  it("setLevel PUTs the new level and applies the returned status", async () => {
    mockAuthFetch.mockResolvedValue(jsonOk({ level: "per_device", sharedCredential: null, backendConnected: true }));

    await s().setLevel("per_device");

    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toContain("/api/mqtt/provisioning/level");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ level: "per_device" });
    expect(s().level).toBe("per_device");
  });

  it("regenerateSharedPassword stores the new credential", async () => {
    mockAuthFetch.mockResolvedValue(jsonOk({ username: "u2", password: "p2" }));
    await s().regenerateSharedPassword();
    expect(s().sharedCredential).toEqual({ username: "u2", password: "p2" });
  });

  it("createCredential returns the new credential and refreshes the list", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(jsonOk({ id: "c1", deviceName: "sensor", username: "sensor", password: "secret" }))
      .mockResolvedValueOnce(jsonOk([{ id: "c1", deviceName: "sensor", username: "sensor", createdAt: 1 }]));

    const cred = await s().createCredential("sensor");

    expect(cred.password).toBe("secret");
    expect(s().credentials).toHaveLength(1);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2); // create + list refresh
  });

  it("createCredential rethrows and clears loading on failure", async () => {
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    await expect(s().createCredential("sensor")).rejects.toThrow("boom");
    expect(s().loading).toBe(false);
  });

  it("revokeCredential removes the credential from local state", async () => {
    useMqttProvisioningStore.setState({
      credentials: [
        { id: "c1", deviceName: "a", username: "a", createdAt: 1 },
        { id: "c2", deviceName: "b", username: "b", createdAt: 2 },
      ],
    });
    mockAuthFetch.mockResolvedValue(jsonOk({}));

    await s().revokeCredential("c1");

    expect(s().credentials.map((c) => c.id)).toEqual(["c2"]);
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toContain("/api/mqtt/provisioning/credentials/c1");
    expect(init?.method).toBe("DELETE");
  });

  it("fetchCredentials loads the list", async () => {
    mockAuthFetch.mockResolvedValue(jsonOk([{ id: "c1", deviceName: "a", username: "a", createdAt: 1 }]));
    await s().fetchCredentials();
    expect(s().credentials).toHaveLength(1);
    expect(s().loading).toBe(false);
  });
});
