// frontend/src/lib/completion-tier.test.ts — Acknowledgement (completion tier) helpers

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("./auth-fetch", () => ({ authFetch: mockAuthFetch }));
vi.mock("./env", () => ({ API_URL: "http://test.local:3001" }));

import {
  CONFIRMATION_TIERS,
  exceedsCeiling,
  fetchCompletionTierCapability,
  isConfirmationTier,
  tierApplies,
  tierLabel,
  tierRank,
} from "./completion-tier";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("tier vocabulary", () => {
  it("exposes exactly the three backend tiers, weakest first", () => {
    expect([...CONFIRMATION_TIERS]).toEqual(["dispatch", "acknowledged", "observed"]);
    expect(tierRank("dispatch")).toBeLessThan(tierRank("acknowledged"));
    expect(tierRank("acknowledged")).toBeLessThan(tierRank("observed"));
  });

  it("accepts only the three tier strings", () => {
    expect(isConfirmationTier("dispatch")).toBe(true);
    expect(isConfirmationTier("observed")).toBe(true);
    expect(isConfirmationTier("ACKNOWLEDGED")).toBe(false);
    expect(isConfirmationTier(null)).toBe(false);
    expect(isConfirmationTier(undefined)).toBe(false);
    expect(isConfirmationTier(2)).toBe(false);
  });

  it("labels a known tier and falls back to the raw value otherwise", () => {
    expect(tierLabel("acknowledged")).toBe("Acknowledged");
    expect(tierLabel("bogus")).toBe("bogus");
  });
});

describe("exceedsCeiling", () => {
  const resolved = (ceiling: "dispatch" | "acknowledged" | "observed") => ({
    deviceId: "d1",
    resolved: true,
    availableTiers: CONFIRMATION_TIERS.slice(0, tierRank(ceiling) + 1) as (
      | "dispatch"
      | "acknowledged"
      | "observed"
    )[],
    ceiling,
  });

  it("flags a request above the device ceiling", () => {
    expect(exceedsCeiling("observed", resolved("acknowledged"))).toBe(true);
    expect(exceedsCeiling("acknowledged", resolved("dispatch"))).toBe(true);
  });

  it("allows a request at or below the ceiling", () => {
    expect(exceedsCeiling("acknowledged", resolved("acknowledged"))).toBe(false);
    expect(exceedsCeiling("dispatch", resolved("observed"))).toBe(false);
  });

  it("never flags when the ceiling is unknown or unresolved", () => {
    expect(exceedsCeiling("observed", null)).toBe(false);
    expect(exceedsCeiling("observed", undefined)).toBe(false);
    expect(
      exceedsCeiling("observed", { deviceId: "d1", resolved: false, availableTiers: [], ceiling: null }),
    ).toBe(false);
  });
});

describe("tierApplies", () => {
  it("applies to script rules and device-directed form actions", () => {
    expect(tierApplies({ ruleType: "script" })).toBe(true);
    expect(tierApplies({ ruleType: "form", actionType: "device_action" })).toBe(true);
    expect(tierApplies({ ruleType: "form", actionType: "toggle" })).toBe(true);
  });

  it("does not apply to actions with nothing to acknowledge", () => {
    for (const actionType of ["log", "publish", "delay", "webhook"]) {
      expect(tierApplies({ ruleType: "form", actionType })).toBe(false);
    }
  });
});

describe("fetchCompletionTierCapability", () => {
  beforeEach(() => mockAuthFetch.mockReset());

  it("returns the reported ceiling for a resolvable device", async () => {
    mockAuthFetch.mockResolvedValue(
      jsonResponse({
        deviceId: "dev-1",
        resolved: true,
        availableTiers: ["dispatch", "acknowledged"],
        ceiling: "acknowledged",
      }),
    );
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toEqual({
      deviceId: "dev-1",
      resolved: true,
      availableTiers: ["dispatch", "acknowledged"],
      ceiling: "acknowledged",
    });
    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test.local:3001/api/devices/dev-1/completion-tiers",
    );
  });

  it("encodes the device id", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ resolved: true, availableTiers: [], ceiling: null }));
    await fetchCompletionTierCapability("a/b c");
    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test.local:3001/api/devices/a%2Fb%20c/completion-tiers",
    );
  });

  it("reports an unresolvable device as a known negative answer", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    await expect(fetchCompletionTierCapability("nope")).resolves.toEqual({
      deviceId: "nope",
      resolved: false,
      availableTiers: [],
      ceiling: null,
    });
  });

  it("returns null when the capability accessor is not wired", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ error: "unavailable" }, 501));
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toBeNull();
  });

  it("returns null when the caller lacks device read", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toBeNull();
  });

  it("returns null when the response body is unreadable", async () => {
    mockAuthFetch.mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toBeNull();
  });

  it("returns null when the request fails outright", async () => {
    mockAuthFetch.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toBeNull();
  });

  it("discards tier values it does not recognise", async () => {
    mockAuthFetch.mockResolvedValue(
      jsonResponse({ resolved: true, availableTiers: ["dispatch", "sideways"], ceiling: "sideways" }),
    );
    await expect(fetchCompletionTierCapability("dev-1")).resolves.toEqual({
      deviceId: "dev-1",
      resolved: true,
      availableTiers: ["dispatch"],
      ceiling: null,
    });
  });
});
