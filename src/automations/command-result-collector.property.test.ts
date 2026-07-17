// src/automations/command-result-collector.property.test.ts
// Feature: unified-command-boundary — Property 9

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CommandResultCollector } from "./command-result-collector.js";
import type { CommandResult } from "./execution-types.js";

const commandResultArb: fc.Arbitrary<CommandResult> = fc.record(
  {
    success: fc.boolean(),
    error: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: ["success"] },
);

// Feature: unified-command-boundary, Property 9: Command results are collected in issue order and fully incorporated
describe("Property 9: Command results are collected in issue order and fully incorporated", () => {
  it("close() returns every explicitly pushed result in the exact push order", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.array(commandResultArb, { maxLength: 20 }), (executionId, results) => {
        const collector = new CommandResultCollector();
        collector.open(executionId);
        for (const r of results) collector.push(executionId, r);
        expect(collector.close(executionId)).toEqual(results);
      }),
      { numRuns: 200 },
    );
  });

  it("pushCurrent() attributes to the execution on the AsyncLocalStorage context, in order", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.array(commandResultArb, { maxLength: 20 }), (executionId, results) => {
        const collector = new CommandResultCollector();
        collector.open(executionId);
        collector.context.run(executionId, () => {
          for (const r of results) collector.pushCurrent(r);
        });
        expect(collector.close(executionId)).toEqual(results);
      }),
      { numRuns: 200 },
    );
  });

  it("interleaved executions keep their results separate and ordered (Req 6.7)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.tuple(fc.boolean(), commandResultArb), { maxLength: 30 }),
        (idA, idB, ops) => {
          fc.pre(idA !== idB);
          const collector = new CommandResultCollector();
          collector.open(idA);
          collector.open(idB);
          const expectedA: CommandResult[] = [];
          const expectedB: CommandResult[] = [];
          for (const [toA, result] of ops) {
            if (toA) {
              expectedA.push(result);
              collector.push(idA, result);
            } else {
              expectedB.push(result);
              collector.push(idB, result);
            }
          }
          expect(collector.close(idA)).toEqual(expectedA);
          expect(collector.close(idB)).toEqual(expectedB);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("pushCurrent() is a no-op when there is no active execution context", () => {
    const collector = new CommandResultCollector();
    expect(() => collector.pushCurrent({ success: true })).not.toThrow();
  });
});
