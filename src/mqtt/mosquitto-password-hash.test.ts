// src/mqtt/mosquitto-password-hash.test.ts — Unit tests for native Mosquitto password hashing.

import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  hashMosquittoPassword,
  buildPasswordLine,
  verifyMosquittoPassword,
} from "./mosquitto-password-hash.js";

describe("mosquitto-password-hash", () => {
  const originalIterationsEnv = process.env.MQTT_PBKDF2_ITERATIONS;

  afterEach(() => {
    if (originalIterationsEnv === undefined) delete process.env.MQTT_PBKDF2_ITERATIONS;
    else process.env.MQTT_PBKDF2_ITERATIONS = originalIterationsEnv;
  });

  describe("hashMosquittoPassword", () => {
    it("produces the $7$<iterations>$<salt>$<hash> structure", () => {
      const hash = hashMosquittoPassword("s3cret", 1000);
      const parts = hash.split("$");
      // Leading empty segment from the leading '$'.
      expect(parts[0]).toBe("");
      expect(parts[1]).toBe("7");
      expect(parts[2]).toBe("1000");
      // Salt and hash are non-empty base64.
      expect(parts[3].length).toBeGreaterThan(0);
      expect(parts[4].length).toBeGreaterThan(0);
    });

    it("decodes to a 12-byte salt and 64-byte (SHA-512) hash", () => {
      const parts = hashMosquittoPassword("password", 1000).split("$");
      expect(Buffer.from(parts[3], "base64")).toHaveLength(12);
      expect(Buffer.from(parts[4], "base64")).toHaveLength(64);
    });

    it("uses a fresh random salt each call (no reuse)", () => {
      const a = hashMosquittoPassword("same", 1000);
      const b = hashMosquittoPassword("same", 1000);
      expect(a).not.toBe(b);
    });

    it("honours an explicit iteration count over the env default", () => {
      process.env.MQTT_PBKDF2_ITERATIONS = "50000";
      expect(hashMosquittoPassword("x", 7).split("$")[2]).toBe("7");
    });

    it("reads the iteration count from MQTT_PBKDF2_ITERATIONS when not passed", () => {
      process.env.MQTT_PBKDF2_ITERATIONS = "4242";
      expect(hashMosquittoPassword("x").split("$")[2]).toBe("4242");
    });

    it("computes PBKDF2-HMAC-SHA512 that matches an independent OpenSSL run", () => {
      // Recompute the hash with the same salt/iterations to prove the KDF params.
      const hash = hashMosquittoPassword("known-value", 2048);
      const [, , iterStr, saltB64, hashB64] = hash.split("$");
      const recomputed = crypto
        .pbkdf2Sync("known-value", Buffer.from(saltB64, "base64"), Number(iterStr), 64, "sha512")
        .toString("base64");
      expect(recomputed).toBe(hashB64);
    });
  });

  describe("buildPasswordLine", () => {
    it("prefixes the username and a colon", () => {
      const line = buildPasswordLine("mqtt-sensor", "pw", 1000);
      expect(line.startsWith("mqtt-sensor:$7$1000$")).toBe(true);
    });
  });

  describe("verifyMosquittoPassword", () => {
    it("accepts the correct password", () => {
      const hash = hashMosquittoPassword("correct horse", 1000);
      expect(verifyMosquittoPassword("correct horse", hash)).toBe(true);
    });

    it("rejects an incorrect password", () => {
      const hash = hashMosquittoPassword("correct horse", 1000);
      expect(verifyMosquittoPassword("battery staple", hash)).toBe(false);
    });

    it("rejects a malformed or non-$7$ hash", () => {
      expect(verifyMosquittoPassword("x", "$2b$12$notpbkdf2")).toBe(false);
      expect(verifyMosquittoPassword("x", "garbage")).toBe(false);
      expect(verifyMosquittoPassword("x", "$7$notanumber$salt$hash")).toBe(false);
    });
  });
});
