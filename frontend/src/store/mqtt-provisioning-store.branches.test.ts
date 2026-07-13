// frontend/src/store/mqtt-provisioning-store.branches.test.ts — Tests targeting uncovered error branches

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { useMqttProvisioningStore } from "./mqtt-provisioning-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useMqttProvisioningStore.getState();

describe("mqtt-provisioning-store — error branches", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    useMqttProvisioningStore.setState({
      level: "open", sharedCredential: null, credentials: [], loading: false,
    });
  });

  it("fetchStatus handles error gracefully", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network error"));
    await s().fetchStatus();
    expect(s().loading).toBe(false);
  });

  it("setLevel handles error gracefully", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network error"));
    await s().setLevel("per_device");
    expect(s().loading).toBe(false);
    // Level should not have changed
    expect(s().level).toBe("open");
  });

  it("regenerateSharedPassword handles error gracefully", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network error"));
    await s().regenerateSharedPassword();
    expect(s().loading).toBe(false);
  });

  it("revokeCredential handles error gracefully", async () => {
    useMqttProvisioningStore.setState({
      credentials: [{ id: "c1", deviceName: "a", username: "a", createdAt: 1 }],
    });
    mockAuthFetch.mockRejectedValue(new Error("network error"));
    await s().revokeCredential("c1");
    expect(s().loading).toBe(false);
    // Credential should remain since revoke failed
    expect(s().credentials).toHaveLength(1);
  });

  it("fetchCredentials handles error gracefully", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network error"));
    await s().fetchCredentials();
    expect(s().loading).toBe(false);
  });

  it("request helper throws when response body is not JSON on error", async () => {
    mockAuthFetch.mockResolvedValue(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
    await s().fetchStatus();
    // Should not throw unhandled — just sets loading false
    expect(s().loading).toBe(false);
  });
});
