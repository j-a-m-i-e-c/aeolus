// src/mqtt/command-envelope.property.test.ts
// Feature: verified-command-execution — Property 11

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildCommandEnvelope } from "./command-envelope.js";

// ─── Property 11: Command envelope mirrors correlation across both mechanisms ─

// Feature: verified-command-execution, Property 11: Command envelope mirrors correlation across both mechanisms
describe("Property 11: Command envelope mirrors correlation across both mechanisms", () => {
  it("correlationId in payload equals the envelope correlationId", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
        fc.string({ minLength: 1 }),
        fc.uuid(),
        (basePayload, responseTopic, correlationId) => {
          const envelope = buildCommandEnvelope(
            basePayload as Record<string, unknown>,
            responseTopic,
            correlationId,
          );

          // Envelope-level id matches payload-level id
          expect(envelope.correlationId).toBe(correlationId);
          expect(envelope.payload.correlationId).toBe(correlationId);
          expect(envelope.correlationId).toBe(envelope.payload.correlationId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("responseTopic in payload equals the envelope responseTopic", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
        fc.string({ minLength: 1 }),
        fc.uuid(),
        (basePayload, responseTopic, correlationId) => {
          const envelope = buildCommandEnvelope(
            basePayload as Record<string, unknown>,
            responseTopic,
            correlationId,
          );

          expect(envelope.responseTopic).toBe(responseTopic);
          expect(envelope.payload.responseTopic).toBe(responseTopic);
          expect(envelope.responseTopic).toBe(envelope.payload.responseTopic);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("base payload fields are preserved in the envelope payload", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s !== "correlationId" && s !== "responseTopic"),
          fc.jsonValue(),
        ),
        fc.string({ minLength: 1 }),
        fc.uuid(),
        (basePayload, responseTopic, correlationId) => {
          const envelope = buildCommandEnvelope(
            basePayload as Record<string, unknown>,
            responseTopic,
            correlationId,
          );

          for (const [key, value] of Object.entries(basePayload)) {
            expect(envelope.payload[key]).toEqual(value);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("generates a UUID when no correlationId is provided", () => {
    const envelope = buildCommandEnvelope({ cmd: "turn_on" }, "aeolus/acks/dev1");
    expect(envelope.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(envelope.payload.correlationId).toBe(envelope.correlationId);
  });
});
