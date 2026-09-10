// showcase-cleanup §2.8 — who may observe a command lifecycle transition.
//
// The WS server's default is fail-closed: a mapping with no visibility resolver is
// admin-only. `command-lifecycle` relied on that default while nothing rendered it.
// A pane now shows its own commands climbing the evidence stages, so the scope is a
// decision rather than a default, and this pins it.
//
// Asserted against the composition root's source because that is where the decision
// lives — the mapping table is local to the bootstrap and the resolver is defined
// inline beside it. A behavioural test would need the whole application wired.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const INDEX = readFileSync(
  path.join(path.resolve(import.meta.dirname, ".."), "index.ts"),
  "utf8",
);

/** Strip comments so prose describing a pattern is not mistaken for the pattern. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(INDEX);

/** The single mapping entry line for a message type. */
function mappingFor(messageType: string): string {
  const line = CODE.split("\n").find(
    (candidate) => candidate.includes(`messageType: "${messageType}"`),
  );
  expect(line, `expected a WS mapping for "${messageType}"`).toBeDefined();
  return line!;
}

describe("command-lifecycle WebSocket visibility", () => {
  it("is scoped to the tabs exposing the automation that issued the command", () => {
    // The same resolver as the automation's state and execution history, so a pane's
    // live command feed reaches exactly the clients that already read that pane.
    const mapping = mappingFor("command-lifecycle");
    expect(mapping).toContain("visibility: automationVisibility");
  });

  it("no longer relies on the admin-only default", () => {
    // A mapping with no resolver is admin-only, which would silently deliver nothing
    // to the non-admin panes the feed was built for.
    const mapping = mappingFor("command-lifecycle");
    expect(/visibility:\s*\w+/.test(mapping)).toBe(true);
  });

  it("uses the same resolver as the automation's own state broadcast", () => {
    // If these ever diverge, a client could observe an automation's commands without
    // being able to observe the automation.
    const commands = mappingFor("command-lifecycle");
    const state = mappingFor("automation-state");
    const resolverOf = (line: string) => /visibility:\s*(\w+)/.exec(line)?.[1];
    expect(resolverOf(commands)).toBe(resolverOf(state));
  });

  it("resolves a command with no automation to admin-only", () => {
    // A REST or system command belongs to no pane. `automationVisibility` returns an
    // admin envelope when the payload carries no ruleId, so this is inherited rather
    // than restated — but the resolver's contract is worth pinning here because the
    // command feed is the first consumer that depends on it for withholding.
    const resolver = /const automationVisibility[\s\S]*?\n  \};/.exec(CODE)?.[0] ?? "";
    expect(resolver).not.toBe("");
    expect(resolver).toContain('stringField(data, "ruleId")');
    expect(resolver).toContain('return { visibility: "admin" }');
  });

  it("leaves automation-event admin-only, since nothing renders it", () => {
    // Scoping an unconsumed event would be speculative work on a security-sensitive
    // path — the reasoning ADR-0011 applied to command-lifecycle until it had a
    // consumer.
    const mapping = mappingFor("automation-event");
    expect(/visibility:/.test(mapping)).toBe(false);
  });
});
