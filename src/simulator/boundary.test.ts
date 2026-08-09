// src/simulator/boundary.test.ts
// phase-2-mqtt-simulator Task 1 — architecture-boundary guard.
//
// Statically proves the simulator never imports Aeolus backend runtime services
// or stores (Req 1.3, 1.4). The simulator is a separate process that speaks only
// MQTT at runtime. It MAY reuse pure, dependency-free protocol modules, so any
// import that resolves OUTSIDE the simulator directory must appear on an
// explicit allowlist and never match a forbidden backend module. Imports that
// resolve within the simulator directory (including subdirectories) are always
// allowed.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SIMULATOR_DIR = import.meta.dirname;

/** Backend runtime services/stores the simulator must never import (Req 1.3). */
const FORBIDDEN_SUBSTRINGS = [
  "command-service",
  "device-registry",
  "connector-manager",
  "action-router",
  "pending-command-tracker",
  "command-history-store",
  "automation-engine",
  "/db/",
  "/api/",
  "/auth/",
  "/websocket/",
  "/connectors/",
  "/data-store/",
];

/**
 * Pure, dependency-free Aeolus modules the simulator is explicitly permitted to
 * reuse (design §1.2), expressed as absolute resolved paths. Any other import
 * resolving outside the simulator directory fails the boundary check.
 */
const APPROVED_CROSS_MODULE_IMPORTS = new Set<string>(
  [
    "../mqtt/command-envelope.js",
    "../mqtt/topic-parser.js",
    "../core/event-metadata.js",
    "../core/types.js",
    "../automations/command-lifecycle.js",
    "../automations/completion-tier.js",
    "../automations/automation-event-service.js",
  ].map((relative) => path.resolve(SIMULATOR_DIR, relative)),
);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g, // import ... from "x"
    /\bimport\s*\(\s*["']([^"']+)["']/g, // dynamic import("x")
    /^\s*import\s+["']([^"']+)["']/gm, // side-effect import "x"
    /\brequire\s*\(\s*["']([^"']+)["']/g, // require("x")
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** Resolve a relative import to an absolute path; undefined for bare specifiers. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined; // bare package or node: builtin
  return path.resolve(path.dirname(fromFile), specifier);
}

describe("simulator architecture boundary", () => {
  const files = collectSourceFiles(SIMULATOR_DIR);

  it("scans at least the skeleton source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports a forbidden backend runtime module", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        const resolved = resolveRelative(file, specifier);
        // Only imports leaving the simulator directory can reach a backend module.
        if (resolved !== undefined && resolved.startsWith(SIMULATOR_DIR)) continue;
        if (FORBIDDEN_SUBSTRINGS.some((forbidden) => specifier.includes(forbidden))) {
          violations.push(`${path.basename(file)} imports forbidden module "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("only reaches outside the simulator directory for approved pure modules", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        const resolved = resolveRelative(file, specifier);
        if (resolved === undefined) continue; // bare package / node builtin
        if (resolved.startsWith(SIMULATOR_DIR)) continue; // intra-simulator import
        if (!APPROVED_CROSS_MODULE_IMPORTS.has(resolved)) {
          violations.push(`${path.relative(SIMULATOR_DIR, file)} imports unapproved module "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
