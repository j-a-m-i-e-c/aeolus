// src/mqtt/mqtt-ack-routing.test.ts — Branch coverage for MQTT ack ingestion routing

import { describe, it, expect, vi } from "vitest";
import { resolveCorrelationId } from "./mqtt-service.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("resolveCorrelationId", () => {
  it("returns MQTT 5 Correlation Data when both sources present", () => {
    const result = resolveCorrelationId(Buffer.from("mqtt5-id"), "payload-id");
    expect(result).toBe("mqtt5-id");
  });

  it("returns payload correlationId when MQTT 5 property absent", () => {
    const result = resolveCorrelationId(undefined, "payload-id");
    expect(result).toBe("payload-id");
  });

  it("returns payload correlationId when MQTT 5 buffer is empty", () => {
    const result = resolveCorrelationId(Buffer.alloc(0), "payload-id");
    expect(result).toBe("payload-id");
  });

  it("returns undefined when neither source present", () => {
    expect(resolveCorrelationId(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when MQTT 5 empty and payload empty string", () => {
    expect(resolveCorrelationId(Buffer.alloc(0), "")).toBeUndefined();
  });

  it("returns undefined when MQTT 5 empty and payload undefined", () => {
    expect(resolveCorrelationId(Buffer.alloc(0), undefined)).toBeUndefined();
  });

  it("handles Uint8Array as correlationData", () => {
    const data = new Uint8Array(Buffer.from("test-id"));
    const result = resolveCorrelationId(data, undefined);
    expect(result).toBe("test-id");
  });
});
