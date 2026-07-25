// frontend/src/lib/api-client.test.ts — Unit tests for the REST API client

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("./env", () => ({ API_URL: "http://test.local:3001" }));

import {
  fetchDevices,
  fetchDevice,
  fetchState,
  fetchHealth,
  sendAction,
  publishMqtt,
  fetchAutomations,
  deleteAutomation,
  fetchLayout,
  saveLayout,
  fetchAvailableConnectors,
  fetchEnabledConnectors,
  enableConnector,
  disableConnector,
  retryConnector,
  executeConnectorSetupStep,
  fetchSetupSteps,
  patchConnectorConfig,
  fetchDeviceHistory,
  clearDeviceHistory,
  clearAllDeviceHistory,
  fetchPrivateTopics,
  addPrivateTopic,
  removePrivateTopic,
} from "./api-client";
import { authFetch } from "./auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("api-client", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it("prefixes requests with API_URL and returns parsed JSON", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([{ id: "dev-1" }]));

    const devices = await fetchDevices();

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test.local:3001/api/devices",
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
    expect(devices).toEqual([{ id: "dev-1" }]);
  });

  it("throws with the server-provided error message on a non-ok response", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ error: "Device not found" }, 404));

    await expect(fetchDevices()).rejects.toThrow("Device not found");
  });

  it("falls back to a status-based message when the error body is not JSON", async () => {
    mockAuthFetch.mockResolvedValue(new Response("nope", { status: 500, statusText: "Server Error" }));

    await expect(fetchDevices()).rejects.toThrow(/Server Error|Request failed: 500/);
  });

  it("sends an action as a POST with a typed body", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));

    await sendAction("dev-1", "toggle", { on: true });

    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("http://test.local:3001/api/devices/dev-1/action");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ type: "toggle", params: { on: true } });
  });

  it("deletes an automation via DELETE", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));

    await deleteAutomation("rule-9");

    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("http://test.local:3001/api/automations/rule-9");
    expect(init?.method).toBe("DELETE");
  });

  it("saves layout via PUT with the payload serialized", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    const payload = { tabs: [], panes: [] } as never;

    await saveLayout(payload);

    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe("http://test.local:3001/api/layout");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ tabs: [], panes: [] });
  });

  it("enables a connector with the snake_case payload the backend expects", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true, id: "c-1" }));

    await enableConnector("hue", { bridgeIp: "1.2.3.4" });

    const body = JSON.parse(mockAuthFetch.mock.calls[0][1]?.body as string);
    expect(body).toEqual({ connector_type: "hue", config: { bridgeIp: "1.2.3.4" } });
  });
});

describe("api-client — remaining endpoints", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  const base = "http://test.local:3001";

  it("issues GET requests to the expected paths", async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [() => fetchDevice("d1"), "/api/devices/d1"],
      [fetchState, "/api/state"],
      [fetchHealth, "/api/health"],
      [fetchAutomations, "/api/automations"],
      [fetchLayout, "/api/layout"],
      [fetchAvailableConnectors, "/api/connectors/available"],
      [fetchEnabledConnectors, "/api/connectors"],
      [() => fetchSetupSteps("c1"), "/api/connectors/c1/setup-steps"],
    ];

    for (const [fn, path] of cases) {
      mockAuthFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await fn();
      expect(mockAuthFetch).toHaveBeenLastCalledWith(
        `${base}${path}`,
        expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
      );
    }
  });

  it("publishes an MQTT message via POST", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    await publishMqtt("sensors/temp", "21.5");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/mqtt/publish`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ topic: "sensors/temp", payload: "21.5" });
  });

  it("disables a connector via DELETE", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    await disableConnector("c-2");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/connectors/c-2`);
    expect(init?.method).toBe("DELETE");
  });

  it("retries a connector via POST", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    await retryConnector("c-3");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/connectors/c-3/retry`);
    expect(init?.method).toBe("POST");
  });

  it("executes a connector setup step with its params as the body", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ done: true }));
    await executeConnectorSetupStep("c-4", "pair", { code: "1234" });
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/connectors/c-4/setup/pair`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ code: "1234" });
  });

  it("patches connector config with a { config } body", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    await patchConnectorConfig("c-5", { pollMs: 5000 });
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/connectors/c-5`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ config: { pollMs: 5000 } });
  });

  it("fetches device history with a limit query when provided", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    await fetchDeviceHistory("d-9", 25);
    expect(mockAuthFetch.mock.calls[0][0]).toBe(`${base}/api/devices/d-9/history?limit=25`);
  });

  it("fetches device history without a query when no limit is given", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    await fetchDeviceHistory("d-9");
    expect(mockAuthFetch.mock.calls[0][0]).toBe(`${base}/api/devices/d-9/history`);
  });

  it("clears one device's history via DELETE", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true, deleted: 3 }));
    await clearDeviceHistory("d-9");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/devices/d-9/history`);
    expect(init?.method).toBe("DELETE");
  });

  it("clears all device history via DELETE", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true, deleted: 10 }));
    await clearAllDeviceHistory();
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/devices/history/all`);
    expect(init?.method).toBe("DELETE");
  });

  it("fetches private topics and unwraps the topics array", async () => {
    const topics = [{ id: "p1", pattern: "home/locks/#", createdAt: 1 }];
    mockAuthFetch.mockResolvedValue(jsonResponse({ topics }));
    const result = await fetchPrivateTopics();
    expect(mockAuthFetch.mock.calls[0][0]).toBe(`${base}/api/mqtt/private-topics`);
    expect(result).toEqual(topics);
  });

  it("adds a private topic via POST and unwraps the topic", async () => {
    const topic = { id: "p2", pattern: "presence/#", createdAt: 2 };
    mockAuthFetch.mockResolvedValue(jsonResponse({ topic }, 201));
    const result = await addPrivateTopic("presence/#");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/mqtt/private-topics`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ pattern: "presence/#" });
    expect(result).toEqual(topic);
  });

  it("removes a private topic via DELETE", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ success: true }));
    await removePrivateTopic("p3");
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(url).toBe(`${base}/api/mqtt/private-topics/p3`);
    expect(init?.method).toBe("DELETE");
  });
});
