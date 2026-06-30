// frontend/src/lib/api-client.test.ts — Unit tests for the REST API client

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("./env", () => ({ API_URL: "http://test.local:3001" }));

import {
  fetchDevices,
  sendAction,
  deleteAutomation,
  saveLayout,
  enableConnector,
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
