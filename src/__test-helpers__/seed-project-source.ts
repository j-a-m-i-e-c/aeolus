// src/__test-helpers__/seed-project-source.ts — authored source for demo Automation Projects.
//
// Demo manifests under scripts/seed/tabs/ are metadata plus a `projectDir`
// reference; the authored Logic/UI lives under scripts/seed/projects/<dir>/ so
// the seeder definitions do not become giant template-string source containers
// (see docs/architecture/AUTOMATION_PROJECTS.md).
//
// The tree is read with the SAME loader the seeder uses
// (scripts/seed/project-loader.mjs), so there is one implementation of the
// project layout. This module only adds the presentation the showcase
// architecture tests want: those tests assert on authored source through the
// `scriptSource` / `uiSource` names they have always used.
//
//   scriptSource → every file under logic/
//   uiSource     → every file under ui/
//
// Files are concatenated in the loader's stable path order, so line-anchored
// lookups such as `startsWith("function subsolar(")` still resolve when a
// project splits helpers across modules.

import { readProjectFiles } from "../../scripts/seed/project-loader.mjs";

export interface SeedAutomationManifest {
  projectDir?: string;
  scriptSource?: string;
  uiSource?: string;
}

/** Read a demo Automation Project's authored Logic and UI source. */
export function readSeedProjectSource(projectDir: string): { scriptSource: string; uiSource: string } {
  const files = readProjectFiles(projectDir);
  const under = (prefix: string) =>
    files.filter((f) => f.path === prefix || f.path.startsWith(`${prefix}/`)).map((f) => f.content).join("\n");
  return { scriptSource: under("logic"), uiSource: under("ui") };
}

/**
 * Attach authored-source views to demo automation manifests, in place.
 *
 * Test-only. The properties are non-enumerable so they never leak into a seed
 * request body — the seeder sends `project` built from `projectDir` instead.
 * Manifests that still carry literal source are left untouched.
 */
export function attachSeedProjectSource(...automations: SeedAutomationManifest[]): void {
  for (const automation of automations) {
    if (!automation?.projectDir) continue;
    let cached: { scriptSource: string; uiSource: string } | undefined;
    const load = () => (cached ??= readSeedProjectSource(automation.projectDir!));
    Object.defineProperties(automation, {
      scriptSource: { get: () => load().scriptSource, enumerable: false, configurable: true },
      uiSource: { get: () => load().uiSource, enumerable: false, configurable: true },
    });
  }
}
