// Regression guard for the public showcase authoring contract.
//
// Every seeded automation is a real Automation Project. This test discovers the
// current project set from disk (no hard-coded count), proves every project is
// referenced by a tab manifest, and runs the production compiler over each tree.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileAutomationProject } from "./automation-project.js";
import { PROJECTS_ROOT, loadProject } from "../../demo/seed/project-loader.mjs";

const TABS_ROOT = path.resolve(import.meta.dirname, "..", "..", "demo", "seed", "tabs");

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

  it("keeps showcase Logic and UI as readable orchestration entry points", () => {
    const failures: string[] = [];

    for (const projectDir of actualProjectDirs()) {
      const source = loadProject(projectDir);
      const logic = source.files.find((file) => file.path === source.logicEntry);
      const ui = source.uiEntry
        ? source.files.find((file) => file.path === source.uiEntry)
        : undefined;

      if (!logic) {
        failures.push(`${projectDir}: missing Logic entry`);
        continue;
      }

      // These are deliberately generous regression ceilings, not style targets.
      // A clear main-method-style entry may be longer than 50 lines; this only
      // catches a return to the old monolithic showcase source.
      const logicLines = logic.content.trim().split(/\r?\n/).length;
      if (logicLines > 90 || logic.content.length > 5_000) {
        failures.push(`${projectDir}: Logic entry has become monolithic (${logicLines} lines, ${logic.content.length} chars)`);
      }
      if (/<(?:div|svg|button|section|article|span)\b/.test(logic.content)) {
        failures.push(`${projectDir}: Logic entry contains UI markup`);
      }
      if (/export\s+default\s+[A-Za-z_$][\w$]*\s*;/.test(logic.content)) {
        failures.push(`${projectDir}: Logic entry is only a forwarding shim`);
      }

      if (ui) {
        const uiLines = ui.content.trim().split(/\r?\n/).length;
        if (uiLines > 90 || ui.content.length > 5_000) {
          failures.push(`${projectDir}: UI entry has become monolithic (${uiLines} lines, ${ui.content.length} chars)`);
        }
        if (/<svg\b|style=\{\{/.test(ui.content)) {
          failures.push(`${projectDir}: UI entry contains low-level visual implementation`);
        }
        if (/export\s+default\s+[A-Za-z_$][\w$]*\s*;/.test(ui.content)) {
          failures.push(`${projectDir}: UI entry is only a forwarding shim`);
        }
        if (!ui.content.includes("aeolus.read(")) {
          failures.push(`${projectDir}: UI entry does not expose its state selection`);
        }
        if (!ui.content.includes("At a glance:")) {
          failures.push(`${projectDir}: UI entry does not explain its composition at a glance`);
        }
        if (/aeolus\.fire\(\s*["']simulate-/.test(ui.content)) {
          failures.push(`${projectDir}: UI entry contains demo-only stimulus wiring; move it behind ui/demo-actions.ts`);
        }
      }

      const logicModules = source.files.filter(
        (file) => file.path.startsWith("logic/") && file.path !== source.logicEntry,
      );
      const uiModules = source.files.filter(
        (file) => file.path.startsWith("ui/") && file.path !== source.uiEntry,
      );
      if (logicModules.length === 0) {
        failures.push(`${projectDir}: showcase Logic has no supporting project file`);
      }
      if (ui && uiModules.length === 0) {
        failures.push(`${projectDir}: showcase UI has no supporting project file`);
      }

      for (const module of source.files.filter((file) => file.path.startsWith("logic/"))) {
        if (/^\s*await\s+devices\.action\s*\(/m.test(module.content)) {
          failures.push(`${projectDir}: ${module.path} discards a devices.action() result instead of checking verification`);
        }
      }

      for (const module of uiModules) {
        // ui/demo-actions.ts is the sanctioned home for public-showcase-only
        // stimulus: the rule above requires the entry to delegate `simulate-*`
        // events here, so firing them from this module is the intended shape. It
        // still must not read or persist shared state, because state selection has
        // to stay visible at the composition entry point.
        const forbidden = module.path === "ui/demo-actions.ts"
          ? /\baeolus\.(?:read|save|saveAndFire)\s*\(/
          : /\baeolus\.(?:read|fire|save|saveAndFire)\s*\(/;
        if (forbidden.test(module.content)) {
          failures.push(`${projectDir}: ${module.path} bypasses the UI composition entry point`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
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
