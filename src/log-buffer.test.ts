// src/log-buffer.test.ts — Unit tests for log buffer

import { describe, it, expect } from "vitest";
import { pushLogEntry, getRecentLogs } from "./log-buffer.js";

describe("log-buffer", () => {
  // Note: The buffer is module-level state, so tests accumulate entries.
  // We test behavior rather than exact counts.

  describe("pushLogEntry", () => {
    it("adds a valid log entry to the buffer", () => {
      const before = getRecentLogs(1000).length;
      pushLogEntry(JSON.stringify({ level: 30, msg: "test message", time: "2024-01-01T00:00:00Z" }));
      const after = getRecentLogs(1000).length;
      expect(after).toBe(before + 1);
    });

    it("maps level numbers to labels", () => {
      pushLogEntry(JSON.stringify({ level: 40, msg: "warning", time: "2024-01-01T00:00:00Z" }));
      const logs = getRecentLogs(1);
      expect(logs[0].levelLabel).toBe("warn");
    });

    it("handles unknown level numbers", () => {
      pushLogEntry(JSON.stringify({ level: 99, msg: "unknown level", time: "2024-01-01T00:00:00Z" }));
      const logs = getRecentLogs(1);
      expect(logs[0].levelLabel).toBe("unknown");
    });

    it("uses current time when time field is missing", () => {
      pushLogEntry(JSON.stringify({ level: 30, msg: "no time" }));
      const logs = getRecentLogs(1);
      expect(logs[0].time).toBeDefined();
    });

    it("uses empty string when msg field is missing", () => {
      pushLogEntry(JSON.stringify({ level: 30, time: "2024-01-01T00:00:00Z" }));
      const logs = getRecentLogs(1);
      expect(logs[0].msg).toBe("");
    });

    it("removes pino internals (pid, hostname)", () => {
      pushLogEntry(JSON.stringify({ level: 30, msg: "test", time: "2024-01-01T00:00:00Z", pid: 1234, hostname: "server" }));
      const logs = getRecentLogs(1);
      expect(logs[0].pid).toBeUndefined();
      expect(logs[0].hostname).toBeUndefined();
    });

    it("ignores unparseable log lines", () => {
      const before = getRecentLogs(1000).length;
      pushLogEntry("not valid json {{{");
      const after = getRecentLogs(1000).length;
      expect(after).toBe(before);
    });

    it("enforces buffer overflow (max 200 entries)", () => {
      // Push enough entries to exceed the buffer
      for (let i = 0; i < 210; i++) {
        pushLogEntry(JSON.stringify({ level: 30, msg: `overflow-${i}`, time: "2024-01-01T00:00:00Z" }));
      }
      const logs = getRecentLogs(1000);
      expect(logs.length).toBeLessThanOrEqual(200);
    });
  });

  describe("getRecentLogs", () => {
    it("returns logs in reverse chronological order (most recent first)", () => {
      pushLogEntry(JSON.stringify({ level: 30, msg: "first", time: "2024-01-01T00:00:01Z" }));
      pushLogEntry(JSON.stringify({ level: 30, msg: "second", time: "2024-01-01T00:00:02Z" }));
      const logs = getRecentLogs(2);
      expect(logs[0].msg).toBe("second");
      expect(logs[1].msg).toBe("first");
    });

    it("respects count parameter", () => {
      pushLogEntry(JSON.stringify({ level: 30, msg: "a", time: "2024-01-01T00:00:00Z" }));
      pushLogEntry(JSON.stringify({ level: 30, msg: "b", time: "2024-01-01T00:00:00Z" }));
      pushLogEntry(JSON.stringify({ level: 30, msg: "c", time: "2024-01-01T00:00:00Z" }));
      const logs = getRecentLogs(2);
      expect(logs.length).toBe(2);
    });

    it("defaults to 100 entries", () => {
      const logs = getRecentLogs();
      expect(logs.length).toBeLessThanOrEqual(100);
    });
  });
});
