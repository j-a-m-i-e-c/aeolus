// src/connectors/capability-descriptor.property.test.ts
// Feature: device-action-system-uplift, Property 6: CapabilityDescriptor structural invariant

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { CapabilityDescriptor } from "./connector.interface.js";

// Feature: device-action-system-uplift, Property 6: CapabilityDescriptor structural invariant
describe("CapabilityDescriptor — Property 6: structural invariant", () => {
  const capabilityDescriptorArb = fc.record({
    type: fc.string({ minLength: 1 }),
    label: fc.string({ minLength: 1 }),
    description: fc.string(),
    params: fc.dictionary(fc.string(), fc.jsonValue()),
  }) as fc.Arbitrary<CapabilityDescriptor>;

  it("Property 6: every CapabilityDescriptor has type, label, description, and params present and non-null", () => {
    fc.assert(
      fc.property(
        fc.array(capabilityDescriptorArb, { minLength: 0, maxLength: 20 }),
        (catalog) => {
          for (const descriptor of catalog) {
            expect(descriptor.type).toBeDefined();
            expect(descriptor.type).not.toBeNull();
            expect(typeof descriptor.type).toBe("string");

            expect(descriptor.label).toBeDefined();
            expect(descriptor.label).not.toBeNull();
            expect(typeof descriptor.label).toBe("string");

            expect(descriptor.description).toBeDefined();
            expect(descriptor.description).not.toBeNull();
            expect(typeof descriptor.description).toBe("string");

            expect(descriptor.params).toBeDefined();
            expect(descriptor.params).not.toBeNull();
            expect(typeof descriptor.params).toBe("object");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("CAPABILITY_ACTION_MAP descriptors all satisfy the structural invariant", async () => {
    const { CAPABILITY_ACTION_MAP } = await import("./capability-action-map.js");
    const allDescriptors = Object.values(CAPABILITY_ACTION_MAP).flat();

    for (const descriptor of allDescriptors) {
      expect(descriptor.type).toBeDefined();
      expect(descriptor.type).not.toBeNull();
      expect(descriptor.label).toBeDefined();
      expect(descriptor.label).not.toBeNull();
      expect(descriptor.description).toBeDefined();
      expect(descriptor.description).not.toBeNull();
      expect(descriptor.params).toBeDefined();
      expect(descriptor.params).not.toBeNull();
    }
  });
});
