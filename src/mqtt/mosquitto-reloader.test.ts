import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { MosquittoReloader } from "./mosquitto-reloader.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: { readFileSync: vi.fn() },
  readFileSync: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("MosquittoReloader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("none strategy (default)", () => {
    it("is a no-op that reports success without shelling out", async () => {
      const reloader = new MosquittoReloader({ strategy: "none" });
      const result = await reloader.reload();
      expect(result).toBe(true);
      expect(execSync).not.toHaveBeenCalled();
    });

    it("is the default when no strategy is given", () => {
      const reloader = new MosquittoReloader();
      expect(reloader.getStrategy()).toBe("none");
    });
  });

  describe("signal strategy", () => {
    it("sends SIGHUP to an explicit PID", async () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      const reloader = new MosquittoReloader({ strategy: "signal", pid: 4321 });

      const result = await reloader.reload();

      expect(result).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(4321, "SIGHUP");
      killSpy.mockRestore();
    });

    it("reads the PID from a PID file when no explicit PID is set", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue("  9090\n");
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      const reloader = new MosquittoReloader({ strategy: "signal", pidFile: "/run/mosq.pid" });

      const result = await reloader.reload();

      expect(result).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(9090, "SIGHUP");
      killSpy.mockRestore();
    });

    it("fails when no PID can be resolved", async () => {
      const reloader = new MosquittoReloader({ strategy: "signal" });
      expect(await reloader.reload()).toBe(false);
    });

    it("returns false when the signal cannot be delivered", async () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("no such process");
      });
      const reloader = new MosquittoReloader({ strategy: "signal", pid: 1 });
      expect(await reloader.reload()).toBe(false);
      killSpy.mockRestore();
    });
  });

  describe("docker strategy", () => {
    it("sends SIGHUP to the container", async () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
      const reloader = new MosquittoReloader({ strategy: "docker", container: "aeolus-mosquitto" });

      const result = await reloader.reload();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith(
        "docker kill --signal=SIGHUP aeolus-mosquitto",
        expect.objectContaining({ timeout: 5000, stdio: "pipe" }),
      );
    });

    it("falls back to restart when SIGHUP fails", async () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error("SIGHUP failed");
        })
        .mockImplementationOnce(() => Buffer.from(""));
      const reloader = new MosquittoReloader({ strategy: "docker", container: "aeolus-mosquitto" });

      const result = await reloader.reload();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(2);
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        "docker restart aeolus-mosquitto",
        expect.objectContaining({ timeout: 5000, stdio: "pipe" }),
      );
    });

    it("returns false when both SIGHUP and restart fail", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command failed");
      });
      const reloader = new MosquittoReloader({ strategy: "docker" });

      expect(await reloader.reload()).toBe(false);
      expect(execSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("command strategy", () => {
    it("runs the configured command", async () => {
      vi.mocked(execSync).mockImplementation(() => Buffer.from(""));
      const reloader = new MosquittoReloader({ strategy: "command", command: "systemctl reload mosquitto" });

      const result = await reloader.reload();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        "systemctl reload mosquitto",
        expect.objectContaining({ timeout: 5000, stdio: "pipe" }),
      );
    });

    it("fails when no command is configured", async () => {
      const reloader = new MosquittoReloader({ strategy: "command" });
      expect(await reloader.reload()).toBe(false);
      expect(execSync).not.toHaveBeenCalled();
    });
  });
});
