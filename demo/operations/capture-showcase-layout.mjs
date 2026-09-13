#!/usr/bin/env node
/**
 * demo/operations/capture-showcase-layout.mjs — turn a hand-arranged showcase into the
 * committed layout fixture (showcase-cleanup §7.2).
 *
 * The workflow this exists for:
 *
 *   make showcase && make showcase-seed PASS=...   start the full local showcase
 *   → arrange the panes by eye in the browser
 *   → make showcase-capture-layout PASS=...        write demo/seed/layouts/showcase-layout.json
 *   → git diff                                    read what changed
 *   → commit                                      every future seed reproduces it
 *
 * Why a tool and not a database snapshot: the spec rules out a hand-tuned SQLite file as
 * the source of truth, and rightly — a binary is not reviewable, does not merge, and
 * carries the whole install along with the two numbers you meant to change.
 *
 * Run it against the unrestricted local showcase, not the public demo: public-demo layout
 * persistence is deliberately disabled, so there would be nothing to capture.
 *
 * The decision about what belongs to the showcase lives in ../seed/layouts/derive.mjs,
 * where it can be tested without a backend. This file is the IO around it.
 *
 * Usage:
 *   node demo/operations/capture-showcase-layout.mjs [url] [username] [password]
 *   node demo/operations/capture-showcase-layout.mjs --check [url] [username] [password]
 */

import { writeFileSync, readFileSync } from "node:fs";
import { createApi, readShowcaseLedger, waitForBackend } from "../seed/lib.mjs";
import { tabModules } from "../seed/tabs/index.mjs";
import {
  LAYOUT_PATH,
  formatShowcaseLayout,
  parseShowcaseLayout,
} from "../seed/layouts/index.mjs";
import { deriveCapturedLayout } from "../seed/layouts/derive.mjs";

const CHECK_ONLY = process.argv.includes("--check");
const args = process.argv.slice(2).filter((a) => a !== "--check");
const API = args[0] || "http://localhost:3001";
const USER = args[1] || "admin";
const PASS = args[2];

if (!PASS) {
  console.error("Error: an admin password is required.\n");
  console.error("  make showcase-capture-layout PASS=<admin-password> [USER=admin]\n");
  console.error(`  node demo/operations/capture-showcase-layout.mjs ${API} ${USER} <password>`);
  process.exit(1);
}

const { api, login } = createApi(API);

console.log(`\n📐 ${CHECK_ONLY ? "Checking" : "Capturing"} showcase layout ← ${API}\n`);
await waitForBackend(API);
await login(USER, PASS);

// The ledger is the only record that distinguishes "the showcase made this" from "a
// person made this". Without it there is nothing safe to capture.
const ledger = await readShowcaseLedger(api);
if (!ledger.existed) {
  console.error("✗ This install has no showcase ledger, so nothing on it is known to belong to");
  console.error("  the showcase. Seed it first:  make showcase-seed PASS=<password>");
  process.exit(1);
}

const live = await api("GET", "/api/layout");
const previous = parseShowcaseLayout();

const { tabs, skipped, missingTabs } = deriveCapturedLayout({
  tabModules,
  ledger,
  liveTabs: Array.isArray(live?.tabs) ? live.tabs : [],
  livePanes: Array.isArray(live?.panes) ? live.panes : [],
  previous: previous.tabs,
});

// Refuse a partial picture before it can be written. A declared tab that is absent from
// the response is never an intentional edit — retiring a tab means deleting it from
// demo/seed/tabs/index.mjs, after which it is not declared — so its absence means the
// answer is untrustworthy, and capturing would erase that tab's geometry wholesale.
//
// This is reachable without anything looking wrong. `GET /api/layout` answers 200 with
// an empty layout if its database read throws, and it filters tabs to the caller's group
// for a non-admin USER, so a mistyped account yields a confident, quietly partial answer.
// Both would otherwise validate, be written, and print a tick.
if (missingTabs.length > 0) {
  console.error(`\n✗ ${missingTabs.length} showcase tab(s) are declared but were not on this dashboard:\n`);
  for (const tabId of missingTabs) console.error(`    · ${tabId}`);
  console.error(`
  Nothing was written. Capturing now would drop those tabs' geometry from the
  fixture, and the next seed would reproduce the loss. Likely causes:

    · the showcase is not fully seeded yet   → make showcase-seed PASS=<password>
    · USER is not an admin, so the dashboard came back filtered to their groups
    · this is not the stack you arranged
`);
  process.exit(1);
}

const before = readFileSync(LAYOUT_PATH, "utf8");
const after = formatShowcaseLayout({ $comment: JSON.parse(before).$comment, tabs });

// Validated with the same parser the seeder uses, before anything is written. Writing a
// file the seeder then refuses would leave seeding broken with the reason one directory
// away.
parseShowcaseLayout(after);

const paneCount = Object.values(tabs).reduce((n, panes) => n + panes.length, 0);
console.log(`  ✓ ${Object.keys(tabs).length} showcase tabs, ${paneCount} panes`);

if (skipped.length > 0) {
  console.log("\n  Not captured:");
  for (const note of skipped) console.log(`    · ${note}`);
}

if (after === before) {
  console.log("\n✅ The live layout already matches the committed fixture.\n");
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error("\n✗ The live layout differs from the committed fixture.");
  console.error("  Run make showcase-capture-layout to update it, then review the diff.\n");
  process.exit(1);
}

writeFileSync(LAYOUT_PATH, after, "utf8");
console.log(`
✅ Wrote demo/seed/layouts/showcase-layout.json

   Review it before committing. This file is the arrangement every future seed
   reproduces, and a stray drag is indistinguishable from an intentional move:

     git diff demo/seed/layouts/showcase-layout.json
`);
