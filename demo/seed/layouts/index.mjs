// demo/seed/layouts/index.mjs — read and validate the canonical showcase layout.
//
// The geometry used to live inline in each tab module, which made the seeder the author
// of the arrangement: `buildLayout` replaced every showcase tab's panes from those
// numbers on each run, so a layout arranged by hand on the Pi was overwritten by the next
// seed. Nobody could tune the showcase by eye and keep it (showcase-cleanup §7.1).
//
// One canonical file keyed by stable ids inverts that. A human arranges the panes, the
// capture tool writes them here, and the seeder reproduces them exactly.
//
// Kept as data rather than code so the capture tool can rewrite it wholesale and the
// operator can read the diff before committing. That is also why the spec rules out a
// hand-tuned SQLite snapshot: a database file is not reviewable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the canonical layout lives. Shared so the capture tool writes what this reads. */
export const LAYOUT_PATH = join(HERE, "showcase-layout.json");

/** Columns in the dashboard grid. A pane must fit inside it. */
export const GRID_COLUMNS = 12;

/**
 * Parse and validate the layout document.
 *
 * Validation is strict and total, because the failure it prevents is silent: a pane with
 * a missing or non-numeric coordinate would be sent to `PUT /api/layout` as `undefined`
 * and land on top of another pane, and the seeder would report success. A layout file is
 * the one input here nobody reads closely — it is generated — so it has to be checked
 * rather than trusted.
 *
 * @param {string} [json] Raw document. Defaults to reading LAYOUT_PATH.
 * @returns {{ tabs: Record<string, {ref?: string, kind?: string, x: number, y: number, w: number, h: number}[]> }}
 */
export function parseShowcaseLayout(json) {
  const raw = json === undefined ? readFileSync(LAYOUT_PATH, "utf8") : json;

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new Error(`showcase layout is not valid JSON: ${err.message}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("showcase layout must be an object");
  }
  if (!doc.tabs || typeof doc.tabs !== "object" || Array.isArray(doc.tabs)) {
    throw new Error("showcase layout needs a `tabs` object keyed by tab id");
  }

  const tabs = {};
  for (const [tabId, panes] of Object.entries(doc.tabs)) {
    if (!Array.isArray(panes)) {
      throw new Error(`showcase layout: tabs["${tabId}"] must be an array of panes`);
    }
    const seen = new Set();
    tabs[tabId] = panes.map((pane, index) => {
      const where = `tabs["${tabId}"][${index}]`;
      if (!pane || typeof pane !== "object") throw new Error(`${where} must be an object`);

      const kind = pane.kind === undefined ? "automation" : pane.kind;
      if (kind !== "automation" && kind !== "device-grid") {
        throw new Error(`${where} has unknown kind "${kind}"`);
      }
      if (kind === "automation") {
        if (typeof pane.ref !== "string" || pane.ref === "") {
          throw new Error(`${where} needs a "ref" naming the automation it shows`);
        }
        // Two panes for one automation would both be written, and the second would win
        // the automation-to-tab ownership the PUT rebuilds from `config.ruleId`.
        if (seen.has(pane.ref)) {
          throw new Error(`${where} repeats ref "${pane.ref}" in the same tab`);
        }
        seen.add(pane.ref);
      }

      const box = {};
      for (const axis of ["x", "y", "w", "h"]) {
        const value = pane[axis];
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`${where}.${axis} must be a non-negative integer, got ${JSON.stringify(value)}`);
        }
        box[axis] = value;
      }
      if (box.w < 1 || box.h < 1) {
        throw new Error(`${where} has no area (w=${box.w}, h=${box.h})`);
      }
      if (box.x + box.w > GRID_COLUMNS) {
        throw new Error(
          `${where} runs past the ${GRID_COLUMNS}-column grid (x=${box.x} + w=${box.w})`,
        );
      }

      return kind === "automation" ? { kind, ref: pane.ref, ...box } : { kind, ...box };
    });
  }

  return { tabs };
}

/**
 * Serialise a layout document the way the committed file is written.
 *
 * One pane per line, because the point of this file is that a human reads its diff
 * before committing it. `JSON.stringify(doc, null, 2)` spreads a four-number pane over
 * six lines and turns moving one pane into a thirty-line diff.
 */
export function formatShowcaseLayout(doc) {
  const tabIds = Object.keys(doc.tabs);
  const body = tabIds
    .map((tabId) => {
      const panes = doc.tabs[tabId]
        .map((pane) => {
          const parts = pane.kind === "device-grid"
            ? [`"kind": "device-grid"`]
            : [`"ref": ${JSON.stringify(pane.ref)}`];
          parts.push(`"x": ${pane.x}`, `"y": ${pane.y}`, `"w": ${pane.w}`, `"h": ${pane.h}`);
          return `      { ${parts.join(", ")} }`;
        })
        .join(",\n");
      return `    ${JSON.stringify(tabId)}: [\n${panes}\n    ]`;
    })
    .join(",\n");

  return `{\n  ${JSON.stringify("$comment")}: ${JSON.stringify(doc.$comment)},\n  "tabs": {\n${body}\n  }\n}\n`;
}
