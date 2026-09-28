import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await copyTextToClipboard("secret");
    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("falls back to execCommand when Clipboard API access is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    await copyTextToClipboard("pi-password");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("throws if neither copy mechanism succeeds", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    await expect(copyTextToClipboard("nope")).rejects.toThrow(/rejected/i);
  });
});
