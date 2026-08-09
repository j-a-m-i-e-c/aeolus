// src/automations/execution-context.test.ts — phase-1 Task 7 execution-context ALS.
import { describe, it, expect } from "vitest";
import { runInExecutionContext, currentExecutionContext } from "./execution-context.js";

describe("execution-context ALS", () => {
  it("returns undefined outside any execution", () => {
    expect(currentExecutionContext()).toBeUndefined();
  });

  it("exposes the active context inside a run", () => {
    runInExecutionContext({ executionId: "X1", causationId: "E1", automationId: "A" }, () => {
      expect(currentExecutionContext()).toEqual({ executionId: "X1", causationId: "E1", automationId: "A" });
    });
    // Cleared after the run returns.
    expect(currentExecutionContext()).toBeUndefined();
  });

  it("does not leak context across concurrent async runs", async () => {
    const seen: Record<string, string | undefined> = {};
    await Promise.all([
      runInExecutionContext({ executionId: "X1", causationId: "E1" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.X1 = currentExecutionContext()?.executionId;
        seen.X1cause = currentExecutionContext()?.causationId;
      }),
      runInExecutionContext({ executionId: "X2", causationId: "E2" }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen.X2 = currentExecutionContext()?.executionId;
        seen.X2cause = currentExecutionContext()?.causationId;
      }),
    ]);
    expect(seen.X1).toBe("X1");
    expect(seen.X1cause).toBe("E1");
    expect(seen.X2).toBe("X2");
    expect(seen.X2cause).toBe("E2");
  });
});
