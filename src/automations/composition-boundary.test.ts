// src/automations/composition-boundary.test.ts
// Feature: unified-command-boundary — composition test (Task 8.4)
//
// Asserts the single-boundary invariant is enforced by construction (Req 1.6,
// 2.8): the device-action route and the custom-UI broker are never handed a
// ConnectorManager / executeAction reference, and CommandService is the
// exported physical-command boundary.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(SRC_ROOT, "..");

/** Strip line and block comments so prose that mentions patterns is not matched. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string, base = SRC_ROOT): string {
  return stripComments(readFileSync(path.join(base, rel), "utf8"));
}

/** Extract the argument text of the `call(...)` invocation (not its import). */
function extractCallArgs(source: string, call: string): string {
  const callRe = new RegExp(`${call}\\s*\\(`);
  const m = callRe.exec(source);
  expect(m, `expected to find a ${call}( call`).not.toBeNull();
  const open = source.indexOf("(", m!.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced parentheses in ${call} call`);
}

describe("construction-enforced command boundary (Req 1.6, 2.8)", () => {
  it("CommandService is the exported physical-command boundary", () => {
    const boundary = read("automations/command-service.ts");
    expect(/export\s+class\s+CommandService\b/.test(boundary)).toBe(true);
  });

  it("createDeviceRoutes takes a CommandService, never a ConnectorManager", () => {
    const routes = read("api/routes/device.routes.ts");
    // Signature depends on CommandService, not ConnectorManager.
    expect(/commandService:\s*CommandService/.test(routes)).toBe(true);
    expect(/:\s*ConnectorManager\b/.test(routes)).toBe(false);
    // The route module holds no executeAction-capable reference.
    expect(/\.executeAction\s*\(/.test(routes)).toBe(false);
    // The catalog is served through a read-only accessor, not the full manager.
    expect(/getActionCatalog:\s*\(/.test(routes)).toBe(true);
  });

  it("the composition root wires the route with the CommandService, not the ConnectorManager", () => {
    const index = read("index.ts");
    const args = extractCallArgs(index, "createDeviceRoutes");

    // The CommandService instance (named actionExecutor at composition) is passed in.
    expect(/\bactionExecutor\b/.test(args)).toBe(true);

    // No bare `connectorManager` argument is passed — the only permitted mention
    // is the read-only accessor `connectorManager.getActionCatalog(...)`, where
    // the identifier is always immediately followed by a `.`.
    const bareConnectorManager = /connectorManager\s*(?![.\w])/.test(args);
    expect(bareConnectorManager, `route args must not receive a bare ConnectorManager: ${args}`).toBe(false);

    // The route must never be granted executeAction.
    expect(/executeAction/.test(args)).toBe(false);
  });

  it("the custom-UI broker holds no ConnectorManager / executeAction reference", () => {
    const broker = read("frontend/src/sandbox/sdk-broker.ts", REPO_ROOT);
    const host = read("frontend/src/sandbox/sandbox-host.ts", REPO_ROOT);
    for (const src of [broker, host]) {
      expect(/ConnectorManager/.test(src)).toBe(false);
      expect(/\.executeAction\s*\(/.test(src)).toBe(false);
    }
  });
});
