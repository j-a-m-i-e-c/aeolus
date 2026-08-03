// src/demo/demo-scrub.test.ts — response masking for public-demo sessions

import { describe, it, expect } from "vitest";
import { scrubForDemo } from "./demo-scrub.js";

const MASK = "•••";

describe("scrubForDemo", () => {
  describe("GET /api/system", () => {
    it("masks hostname and network addresses but keeps numeric metrics", () => {
      const body = {
        hostname: "aeolus-prod-01",
        platform: "linux",
        cpuCores: 4,
        memory: { total: 8000, used: 4000, usagePercent: 50 },
        network: [{ name: "eth0", address: "192.168.1.42" }],
        uptime: 12345,
      };
      const out = scrubForDemo("/api/system", body) as typeof body;
      expect(out.hostname).toBe(MASK);
      expect(out.network[0].address).toBe(MASK);
      expect(out.network[0].name).toBe("eth0");
      expect(out.platform).toBe("linux");
      expect(out.cpuCores).toBe(4);
      expect(out.memory.usagePercent).toBe(50);
      expect(out.uptime).toBe(12345);
    });
  });

  describe("GET /api/system/logs", () => {
    it("scrubs inline IPs from messages and masks sensitive context keys", () => {
      const body = [
        { level: 30, levelLabel: "info", time: "2026-01-01", msg: "request from 10.0.0.5 ok", ip: "10.0.0.5", userId: "u-abc" },
      ];
      const out = scrubForDemo("/api/system/logs", body) as Array<Record<string, unknown>>;
      expect(out[0].msg).toBe(`request from ${MASK} ok`);
      expect(out[0].ip).toBe(MASK);
      expect(out[0].userId).toBe(MASK);
      expect(out[0].levelLabel).toBe("info");
      expect(out[0].level).toBe(30);
    });

    it("passes through a non-array body unchanged", () => {
      expect(scrubForDemo("/api/system/logs", [])).toEqual([]);
    });
  });

  describe("GET /api/connectors", () => {
    it("masks connector config secrets and host identifiers, keeps benign fields", () => {
      const body = [
        {
          id: "c1",
          connectorType: "hue",
          config: { bridgeIp: "192.168.1.5", apiKey: "supersecretkeyvalue", pollInterval: 30 },
          deviceCount: 3,
        },
      ];
      const out = scrubForDemo("/api/connectors", body) as Array<Record<string, unknown>>;
      const config = out[0].config as Record<string, unknown>;
      expect(config.bridgeIp).toBe(MASK);
      expect(config.apiKey).toBe(MASK);
      expect(config.pollInterval).toBe(30);
      expect(out[0].connectorType).toBe("hue");
      expect(out[0].deviceCount).toBe(3);
    });
  });

  describe("GET /api/connectors/:id/status", () => {
    it("masks the config on a single status object", () => {
      const body = { id: "c1", connectorType: "hue", config: { username: "abcd", host: "10.1.1.1" }, health: { status: "connected" } };
      const out = scrubForDemo("/api/connectors/c1/status", body) as Record<string, unknown>;
      const config = out.config as Record<string, unknown>;
      expect(config.username).toBe(MASK);
      expect(config.host).toBe(MASK);
      expect((out.health as Record<string, unknown>).status).toBe("connected");
    });
  });

  describe("GET /api/connectors/available", () => {
    it("is passed through unchanged (static catalog metadata)", () => {
      const body = [{ metadata: { id: "hue", displayName: "Philips Hue" }, configSchema: [{ id: "apiKey", type: "password" }] }];
      expect(scrubForDemo("/api/connectors/available", body)).toEqual(body);
    });
  });

  describe("GET /api/auth/users", () => {
    it("pseudonymises usernames while preserving role and group", () => {
      const body = [
        { id: "u1", username: "Jamie", role: "admin", groupId: null, createdAt: 1 },
        { id: "u2", username: "bob", role: "user", groupId: "g1", createdAt: 2 },
      ];
      const out = scrubForDemo("/api/auth/users", body) as Array<Record<string, unknown>>;
      expect(out[0].username).toBe("administrator");
      expect(out[1].username).toBe("member-2");
      expect(out[0].role).toBe("admin");
      expect(out[1].role).toBe("user");
      expect(out[1].groupId).toBe("g1");
      // No real username survives.
      const serialised = JSON.stringify(out);
      expect(serialised).not.toContain("Jamie");
      expect(serialised).not.toContain("bob");
    });
  });

  describe("GET /api/auth/mqtt-credentials", () => {
    it("masks username and password fields, keeps deviceName", () => {
      const body = [{ id: "m1", deviceName: "Living Room Sensor", username: "dev-lrs", password: "s3cr3t", createdAt: 5 }];
      const out = scrubForDemo("/api/auth/mqtt-credentials", body) as Array<Record<string, unknown>>;
      expect(out[0].username).toBe(MASK);
      expect(out[0].password).toBe(MASK);
      expect(out[0].deviceName).toBe("Living Room Sensor");
      expect(out[0].id).toBe("m1");
    });
  });

  describe("GET /api/mqtt/provisioning/status", () => {
    it("preserves a null sharedCredential (does not turn null into a mask)", () => {
      const body = { level: "open", sharedCredential: null, backendConnected: true, managedProvisioningEnabled: false };
      const out = scrubForDemo("/api/mqtt/provisioning/status", body) as Record<string, unknown>;
      expect(out.sharedCredential).toBeNull();
      expect(out.level).toBe("open");
      expect(out.managedProvisioningEnabled).toBe(false);
    });
  });

  describe("unlisted paths", () => {
    it("returns groups unchanged (no host/credential data)", () => {
      const body = [{ id: "g1", name: "Public Demo", tabAssignments: [] }];
      expect(scrubForDemo("/api/auth/groups", body)).toEqual(body);
    });

    it("returns data-store records unchanged (demo-generated fake data)", () => {
      const body = { records: [{ id: 1, payload: { temp: 21 } }], total: 1 };
      expect(scrubForDemo("/api/data-store/collections/env/records", body)).toEqual(body);
    });
  });
});
