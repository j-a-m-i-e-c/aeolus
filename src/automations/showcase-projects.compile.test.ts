// Regression guard for the public showcase authoring contract.
//
// Every seeded automation is a real Automation Project. This test discovers the
// current project set from disk (no hard-coded count), proves every project is
// referenced by a tab manifest, and runs the production compiler over each tree.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileAutomationProject } from "./automation-project.js";
import { PROJECTS_ROOT, loadProject } from "../../scripts/seed/project-loader.mjs";

const TABS_ROOT = path.resolve(import.meta.dirname, "..", "..", "scripts", "seed", "tabs");

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function referencedProjectDirs(): string[] {
  const refs: string[] = [];
  for (const file of walkFiles(TABS_ROOT).filter((candidate) => candidate.endsWith(".mjs"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["']projectDir["']\s*:\s*["']([^"']+)["']/g)) {
      refs.push(match[1]);
    }
  }
  return refs.sort();
}

function actualProjectDirs(): string[] {
  return readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("seeded Automation Projects", () => {
  it("has a one-to-one mapping between tab manifests and project directories", () => {
    const actual = actualProjectDirs();
    const referenced = referencedProjectDirs();

    expect(actual.length).toBeGreaterThan(0);
    expect(new Set(referenced).size).toBe(referenced.length);
    expect(referenced).toEqual(actual);
  });

  it("compiles every currently seeded Automation Project with the production compiler", async () => {
    const projects = actualProjectDirs();
    const failures: string[] = [];

    for (const projectDir of projects) {
      try {
        const source = loadProject(projectDir);
        expect(source.files.some((file) => file.path === source.logicEntry)).toBe(true);
        await compileAutomationProject(source);
      } catch (error) {
        failures.push(`${projectDir}: ${(error as Error).message}`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  }, 30_000);
});
