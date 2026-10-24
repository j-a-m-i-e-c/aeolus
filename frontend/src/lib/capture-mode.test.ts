import { afterEach, describe, expect, it, vi } from "vitest";
import {
  failSafeStorage,
  removeCaptureParam,
  resolveBrowserCaptureMode,
  resolveCaptureMode,
  type CaptureModeStorage,
} from "./capture-mode";

function memoryStorage(initial?: Record<string, string>): CaptureModeStorage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("capture mode", () => {
  it("enables from the query string and persists for same-tab navigation", () => {
    const storage = memoryStorage();
    expect(resolveCaptureMode("?capture=1", storage)).toBe(true);
    expect(resolveCaptureMode("", storage)).toBe(true);
  });

  it("can be explicitly disabled", () => {
    const storage = memoryStorage({ "aeolus:capture-mode": "1" });
    expect(resolveCaptureMode("?capture=0", storage)).toBe(false);
    expect(resolveCaptureMode("", storage)).toBe(false);
  });

  it("ignores unknown query values", () => {
    const storage = memoryStorage();
    expect(resolveCaptureMode("?capture=maybe", storage)).toBe(false);
  });

  it("removes capture while preserving other query parameters", () => {
    expect(removeCaptureParam("?capture=1&tab=water&foo=bar")).toBe("?tab=water&foo=bar");
  });

  it("returns an empty query string when capture was the only parameter", () => {
    expect(removeCaptureParam("?capture=0")).toBe("");
  });

  it("removes every capture parameter without disturbing unrelated values", () => {
    expect(removeCaptureParam("?foo=1&capture=1&capture=0&bar=2")).toBe("?foo=1&bar=2");
  });
});

describe("failSafeStorage", () => {
  const blocked = (): CaptureModeStorage => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };

  it("treats blocked storage as empty instead of throwing", () => {
    const storage = failSafeStorage(blocked);
    expect(storage.getItem("aeolus:capture-mode")).toBeNull();
    expect(() => storage.setItem("aeolus:capture-mode", "1")).not.toThrow();
    expect(() => storage.removeItem("aeolus:capture-mode")).not.toThrow();
  });

  it("still honours an explicit ?capture=1 for the current page when storage is blocked", () => {
    expect(resolveCaptureMode("?capture=1", failSafeStorage(blocked))).toBe(true);
    // ...but cannot remember it for the next navigation.
    expect(resolveCaptureMode("", failSafeStorage(blocked))).toBe(false);
  });

  it("passes through to working storage", () => {
    const backing = memoryStorage();
    const storage = failSafeStorage(() => backing);
    storage.setItem("k", "v");
    expect(backing.getItem("k")).toBe("v");
    expect(storage.getItem("k")).toBe("v");
    storage.removeItem("k");
    expect(backing.getItem("k")).toBeNull();
  });
});

describe("resolveBrowserCaptureMode", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("consumes ?capture=1, keeps other parameters and the hash, and remembers the choice", () => {
    window.history.replaceState({ marker: 1 }, "", "/tab/water?capture=1&foo=bar#pane-3");
    const storage = memoryStorage();

    expect(resolveBrowserCaptureMode(storage)).toBe(true);
    expect(window.location.pathname).toBe("/tab/water");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#pane-3");
    expect(window.history.state).toEqual({ marker: 1 });
    expect(storage.getItem("aeolus:capture-mode")).toBe("1");
  });

  it("leaves the URL alone when there is no capture parameter", () => {
    window.history.replaceState(null, "", "/tab/water?foo=bar");
    const replaceState = vi.spyOn(window.history, "replaceState");

    expect(resolveBrowserCaptureMode(memoryStorage({ "aeolus:capture-mode": "1" }))).toBe(true);
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("strips an unrecognised capture value without changing the remembered mode", () => {
    window.history.replaceState(null, "", "/?capture=maybe");
    expect(resolveBrowserCaptureMode(memoryStorage())).toBe(false);
    expect(window.location.search).toBe("");
  });

  it("defaults to the browser's sessionStorage", () => {
    window.sessionStorage.removeItem("aeolus:capture-mode");
    window.history.replaceState(null, "", "/?capture=1");
    expect(resolveBrowserCaptureMode()).toBe(true);
    expect(window.sessionStorage.getItem("aeolus:capture-mode")).toBe("1");
    window.sessionStorage.removeItem("aeolus:capture-mode");
  });
});
