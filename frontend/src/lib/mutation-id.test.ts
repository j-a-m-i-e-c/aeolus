import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRememberedMutations,
  createMutationId,
  isLocalMutation,
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

  it("remembers local mutations and bounds the history", () => {
    for (let i = 0; i < 129; i += 1) rememberLocalMutation(`m-${i}`);
    expect(isLocalMutation("m-0")).toBe(false);
    expect(isLocalMutation("m-1")).toBe(true);
    expect(isLocalMutation("m-128")).toBe(true);
    expect(isLocalMutation(null)).toBe(false);
  });

  it("does not duplicate remembered ids and can reset", () => {
    rememberLocalMutation("same");
    rememberLocalMutation("same");
    expect(isLocalMutation("same")).toBe(true);
    clearRememberedMutations();
    expect(isLocalMutation("same")).toBe(false);
  });
});
