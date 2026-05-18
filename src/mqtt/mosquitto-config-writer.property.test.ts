// Feature: mqtt-device-provisioning, Property 3: Mosquitto config file correctness per security level
import { describe, expect, afterEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MosquittoConfigWriter } from "./mosquitto-config-writer.js";

type SecurityLevel = "open" | "shared_password" | "per_device";

describe("Feature: mqtt-device-provisioning — Property 3: Mosquitto config file correctness per security level", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Property 3: Mosquitto config file correctness per security level
  // **Validates: Requirements 1.5, 2.1, 2.2, 3.3, 4.1**
  test.prop(
    [fc.constantFrom<SecurityLevel>("open", "shared_password", "per_device")],
    { numRuns: 100 }
  )(
    "Property 3: Config file correctness — open produces allow_anonymous true and no password_file; shared_password and per_device produce allow_anonymous false and password_file directive",
    (level) => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mosquitto-config-test-"));
      const configPath = path.join(tempDir, "mosquitto.conf");

      const writer = new MosquittoConfigWriter({ configPath });

      if (level === "open") {
        writer.writeOpenConfig();
      } else {
        writer.writeAuthenticatedConfig("/mosquitto/config/password_file");
      }

      const content = fs.readFileSync(configPath, "utf-8");

      if (level === "open") {
        expect(content).toContain("allow_anonymous true");
        expect(content).not.toContain("password_file");
      } else {
        expect(content).toContain("allow_anonymous false");
        expect(content).toContain("password_file /mosquitto/config/password_file");
      }
    }
  );
});
