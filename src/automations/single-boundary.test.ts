// src/automations/single-boundary.test.ts
// Feature: unified-command-boundary — architecture test (Task 8.3)
//
// Enforces Req 1.1 / 2.7 by construction: outside the ConnectorManager
// subsystem (which owns and implements executeAction, and where connectors may
// legitimately compose device actions internally), the ONLY place that invokes
// `.executeAction(` is the CommandService boundary in command-service.ts. No
// Command_Source (REST route, sandbox host, composition root, websocket, other
// API routes) may call it directly.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

/** The ConnectorManager subsystem owns/implements executeAction and its
 *  connectors may compose device actions internally; it is downstream of the
 *  boundary, not a Command_Source, so it is exempt from the call-site scan. */
const CONNECTOR_SUBSYSTEM = path.join(SRC_ROOT, "connectors");

/** The single boundary permitted to invoke ConnectorManager.executeAction(). */
const BOUNDARY_FILE = path.join(SRC_ROOT, "automations", "command-service.ts");

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !isTestFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip line and block comments so the architecture note in command-service.ts
 *  (which mentions the pattern in prose) is not counted as a call site. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("single physical-command boundary (Req 1.1, 2.7)", () => {
  it("only command-service.ts invokes .executeAction() outside the connector subsystem", () => {
    const offenders: string[] = [];

    for (const file of listSourceFiles(SRC_ROOT)) {
      // Exempt the ConnectorManager subsystem — it owns/implements executeAction.
      if (file.startsWith(CONNECTOR_SUBSYSTEM + path.sep)) continue;

      const code = stripComments(readFileSync(file, "utf8"));
      if (!/\.executeAction\s*\(/.test(code)) continue;

      if (path.resolve(file) !== path.resolve(BOUNDARY_FILE)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders, `Unexpected executeAction() call sites: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the boundary file itself does invoke executeAction (sanity check on the scan)", () => {
    const code = stripComments(readFileSync(BOUNDARY_FILE, "utf8"));
    expect(/\.executeAction\s*\(/.test(code)).toBe(true);
  });
});
