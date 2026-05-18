import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MosquittoConfigWriter } from "./mosquitto-config-writer.js";

describe("MosquittoConfigWriter", () => {
  let tempDir: string;

  function createTempDir(): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mosquitto-config-test-"));
    return tempDir;
  }

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("writeOpenConfig writes correct content", () => {
    it("contains all expected open mode directives", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeOpenConfig();

      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("listener 1883");
      expect(content).toContain("allow_anonymous true");
      expect(content).toContain("persistence true");
      expect(content).toContain("persistence_location /mosquitto/data/");
      expect(content).toContain("log_dest stdout");
    });

    it("does NOT contain password_file directive", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeOpenConfig();

      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).not.toContain("password_file");
    });
  });

  describe("writeAuthenticatedConfig writes correct content", () => {
    it("contains allow_anonymous false and password_file directive", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeAuthenticatedConfig("/mosquitto/config/password_file");

      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("allow_anonymous false");
      expect(content).toContain("password_file /mosquitto/config/password_file");
      expect(content).toContain("listener 1883");
      expect(content).toContain("persistence true");
      expect(content).toContain("persistence_location /mosquitto/data/");
      expect(content).toContain("log_dest stdout");
    });

    it("does NOT contain allow_anonymous true", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeAuthenticatedConfig("/mosquitto/config/password_file");

      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).not.toContain("allow_anonymous true");
    });
  });

  describe("writes atomically (no partial file at target path during write)", () => {
    it("target file exists after write and contains valid content", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeOpenConfig();

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain("listener 1883");
    });

    it("no temp files remain after write completes", () => {
      const dir = createTempDir();
      const configPath = path.join(dir, "mosquitto.conf");
      const writer = new MosquittoConfigWriter({ configPath });

      writer.writeOpenConfig();

      const files = fs.readdirSync(dir);
      const tempFiles = files.filter((f) => f.startsWith(".mosquitto.conf.tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe("creates parent directory if needed", () => {
    it("writes successfully to a nested path that does not yet exist", () => {
      const dir = createTempDir();
      const nestedPath = path.join(dir, "nested", "deep", "mosquitto.conf");
      // Create the nested directory structure since atomicWrite expects the parent to exist
      fs.mkdirSync(path.dirname(nestedPath), { recursive: true });
      const writer = new MosquittoConfigWriter({ configPath: nestedPath });

      writer.writeOpenConfig();

      expect(fs.existsSync(nestedPath)).toBe(true);
      const content = fs.readFileSync(nestedPath, "utf-8");
      expect(content).toContain("listener 1883");
      expect(content).toContain("allow_anonymous true");
    });
  });
});
