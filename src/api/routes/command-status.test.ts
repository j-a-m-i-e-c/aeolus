// src/api/routes/command-status.test.ts — Unit tests for the outcome→status mapping.

import { describe, it, expect } from "vitest";
import { httpStatusForCommandResult } from "./command-status.js";
import type { ActionResult } from "../../core/types.js";

describe("httpStatusForCommandResult", () => {
  it("maps every success lifecycle state to 200", () => {
    for (const lifecycleState of ["DISPATCHED", "ACKNOWLEDGED", "OBSERVED"] as const) {
      const result: ActionResult = { success: true, lifecycleState };
      expect(httpStatusForCommandResult(result)).toBe(200);
    }
  });

  it("maps a bare success (no lifecycle) to 200", () => {
    expect(httpStatusForCommandResult({ success: true })).toBe(200);
  });

  it("maps TIMED_OUT to 504", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "TIMED_OUT" }),
    ).toBe(504);
  });

  it("maps STATE_MISMATCH to 409", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "STATE_MISMATCH" }),
    ).toBe(409);
  });

  it("maps FAILED not_found to 404", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED", failureKind: "not_found" }),
    ).toBe(404);
  });

  it("maps FAILED transport to 503", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED", failureKind: "transport" }),
    ).toBe(503);
  });

  it("maps FAILED execution to 502", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED", failureKind: "execution" }),
    ).toBe(502);
  });

  it("maps FAILED unsupported and invalid_params to 422", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED", failureKind: "unsupported" }),
    ).toBe(422);
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED", failureKind: "invalid_params" }),
    ).toBe(422);
  });

  it("defaults an unclassified FAILED to 422", () => {
    expect(
      httpStatusForCommandResult({ success: false, lifecycleState: "FAILED" }),
    ).toBe(422);
  });

  it("defaults a failure with no lifecycle to 422", () => {
    expect(httpStatusForCommandResult({ success: false })).toBe(422);
  });
});
