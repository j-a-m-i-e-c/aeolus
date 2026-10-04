import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRememberedMutations,
  createMutationId,
  consumeLocalMutation,
  rememberLocalMutation,
} from "./mutation-id";

afterEach(() => {
  clearRememberedMutations();
  vi.unstubAllGlobals();
});

describe("mutation-id", () => {
  it("uses randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(createMutationId()).toBe("uuid-1");
  });

  it("has a unique fallback when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const first = createMutationId();
    const second = createMutationId();
    expect(first).toBe("mutation-1234-1");
    expect(second).toBe("mutation-1234-2");
    vi.restoreAllMocks();
  });

  it("falls back when crypto exists but carries no randomUUID", () => {
    // Non-secure contexts and older browsers expose crypto without randomUUID,
    // which is why the guard checks the method rather than just the object.
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(5678);
    expect(createMutationId()).toBe("mutation-5678-1");
    vi.restoreAllMocks();
  });

  it("remembers local mutations and bounds the history", () => {
    for (let i = 0; i < 129; i += 1) rememberLocalMutation(`m-${i}`);
    expect(consumeLocalMutation("m-0")).toBe(false);
    expect(consumeLocalMutation("m-1")).toBe(true);
    expect(consumeLocalMutation("m-1")).toBe(false);
    expect(consumeLocalMutation("m-128")).toBe(true);
    expect(consumeLocalMutation(null)).toBe(false);
  });

  it("does not duplicate remembered ids and can reset", () => {
    rememberLocalMutation("same");
    rememberLocalMutation("same");
    expect(consumeLocalMutation("same")).toBe(true);
    expect(consumeLocalMutation("same")).toBe(false);
    rememberLocalMutation("again");
    clearRememberedMutations();
    expect(consumeLocalMutation("again")).toBe(false);
  });
});
