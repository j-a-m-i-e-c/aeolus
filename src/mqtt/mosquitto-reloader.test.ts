import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { MosquittoReloader } from "./mosquitto-reloader.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("MosquittoReloader", () => {
  let reloader: MosquittoReloader;

  beforeEach(() => {
    vi.clearAllMocks();
    reloader = new MosquittoReloader();
  });

  it("reload returns true when SIGHUP succeeds", async () => {
    vi.mocked(execSync).mockImplementation(() => Buffer.from(""));

    const result = await reloader.reload();

    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync).toHaveBeenCalledWith(
      "docker kill --signal=SIGHUP aeolus-mosquitto",
      expect.objectContaining({ timeout: 5000, stdio: "pipe" })
    );
  });

  it("reload falls back to restart when SIGHUP fails", async () => {
    vi.mocked(execSync)
      .mockImplementationOnce(() => {
        throw new Error("SIGHUP failed");
      })
      .mockImplementationOnce(() => Buffer.from(""));

    const result = await reloader.reload();

    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledTimes(2);
    expect(execSync).toHaveBeenNthCalledWith(
      1,
      "docker kill --signal=SIGHUP aeolus-mosquitto",
      expect.objectContaining({ timeout: 5000, stdio: "pipe" })
    );
    expect(execSync).toHaveBeenNthCalledWith(
      2,
      "docker restart aeolus-mosquitto",
      expect.objectContaining({ timeout: 5000, stdio: "pipe" })
    );
  });

  it("reload returns false when both SIGHUP and restart fail", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command failed");
    });

    const result = await reloader.reload();

    expect(result).toBe(false);
    expect(execSync).toHaveBeenCalledTimes(2);
  });
});
