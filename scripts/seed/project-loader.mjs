// scripts/seed/project-loader.mjs — single source of truth for reading a demo
// Automation Project off disk.
//
// Demo manifests under scripts/seed/tabs/ carry only metadata plus a
// `projectDir`; the authored Logic/UI lives under scripts/seed/projects/<dir>/
// (see docs/architecture/AUTOMATION_PROJECTS.md). Both the seeder and the
// showcase architecture tests need that tree, so the traversal and entry
// resolution live here once rather than being reimplemented per consumer.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECTS_ROOT = fileURLToPath(new URL("./projects/", import.meta.url));
export const DEFAULT_LOGIC_ENTRY = "logic/index.ts";
export const DEFAULT_UI_ENTRY = "ui/index.tsx";

/**
 * Recursively read a project directory into POSIX-relative files, sorted by
 * path so callers get a stable order.
 *
 * @param {string} projectDir directory name under scripts/seed/projects/
 * @returns {{ path: string, content: string }[]}
 */
export function readProjectFiles(projectDir) {
  const root = path.join(PROJECTS_ROOT, projectDir);
  /** @type {{ path: string, content: string }[]} */
  const files = [];

  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          content: readFileSync(absolute, "utf8"),
        });
      }
    }
  };

  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read a project as the payload the automation API accepts. The UI entry is
 * declared only when the project actually ships one.
 *
 * @param {string} projectDir directory name under scripts/seed/projects/
 */
export function loadProject(projectDir) {
  const files = readProjectFiles(projectDir);
  return {
    files,
    logicEntry: DEFAULT_LOGIC_ENTRY,
    uiEntry: files.some((file) => file.path === DEFAULT_UI_ENTRY) ? DEFAULT_UI_ENTRY : null,
  };
}
