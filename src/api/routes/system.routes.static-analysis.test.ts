// src/api/routes/system.routes.static-analysis.test.ts — Static analysis: Property 2 (No Spawn Import)
// **Validates: Requirements 2.1, 2.2, 2.3**

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.resolve(__dirname, "system.routes.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

describe("Property 2: No Spawn Import — static analysis of system.routes.ts", () => {
  const forbiddenImports = [
    "spawn",
    "spawnSync",
    "exec",
    "execFile",
    "execFileSync",
    "fork",
  ];

  it("should not import spawn, spawnSync, exec, execFile, execFileSync, or fork from child_process", () => {
    for (const fn of forbiddenImports) {
      // Match destructured imports like: import { spawn } from "child_process"
      // or: import { exec, spawn } from "node:child_process"
      const importRegex = new RegExp(
        `import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*["'](?:node:)?child_process["']`,
      );
      expect(
        importRegex.test(source),
        `Forbidden import "${fn}" found from child_process`,
      ).toBe(false);
    }
  });

  it("should only import execSync from child_process", () => {
    // Find all import statements from child_process
    const childProcessImports = source.match(
      /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g,
    );

    expect(
      childProcessImports,
      "Expected at least one import from child_process (execSync)",
    ).not.toBeNull();

    // Extract all imported identifiers from child_process
    const importedNames: string[] = [];
    for (const stmt of childProcessImports!) {
      const match = stmt.match(/import\s*\{([^}]*)\}/);
      if (match) {
        const names = match[1].split(",").map((n) => n.trim());
        importedNames.push(...names);
      }
    }

    expect(importedNames).toEqual(["execSync"]);
  });

  it('should not contain "docker" anywhere in the source', () => {
    expect(
      /docker/i.test(source),
      'Found "docker" string in source — no Docker commands should exist',
    ).toBe(false);
  });

  it('should not contain "git" as a command in the source', () => {
    // Match git as a standalone command/word (not inside words like "digit")
    // Check for git CLI usage patterns: "git ", "git\n", 'git', etc.
    const gitCommandPatterns = [
      /["'`]git\s/,        // "git " or 'git ' — git followed by space in a string
      /["'`]git["'`]/,     // "git" as standalone string
      /\bgit\s+(?:rev-parse|log|fetch|pull|push|clone|config|status|diff|commit|merge|rebase|checkout|branch|tag|stash|reset|clean|remote|add|rm)\b/,
    ];

    for (const pattern of gitCommandPatterns) {
      expect(
        pattern.test(source),
        `Found git command pattern in source: ${pattern}`,
      ).toBe(false);
    }
  });

  it('should not contain "nsenter" anywhere in the source', () => {
    expect(
      /nsenter/i.test(source),
      'Found "nsenter" string in source',
    ).toBe(false);
  });

  it('should not contain "chroot" anywhere in the source', () => {
    expect(
      /chroot/i.test(source),
      'Found "chroot" string in source',
    ).toBe(false);
  });

  it('should not contain "--pid=host" anywhere in the source', () => {
    expect(
      /--pid=host/.test(source),
      'Found "--pid=host" string in source',
    ).toBe(false);
  });
});
