#!/usr/bin/env node
/**
 * seed-demo.mjs — Populate Aeolus with the multi-domain demo.
 *
 * Showcases the platform across distinct deployment domains — smart home,
 * research vessel, agriculture, underground mining, spacecraft, escape room,
 * and an off-grid bunker — proving the core abstractions are domain-agnostic.
 *
 * Each tab lives in its own module under scripts/seed/tabs/. This orchestrator
 * wires them together: clean → automations → devices → data store → layout.
 *
 * Usage:
 *   node scripts/seed-demo.mjs [url] [username] [password]
 * Example:
 *   node scripts/seed-demo.mjs http://localhost:3001 admin mypass
 *
 * Prerequisites: Aeolus running, and an admin account already created.
 */

import {
  createApi,
  cleanSlate,
  enableDataStore,
  publishDevices,
  createAutomations,
  seedCollection,
  buildLayout,
  fireAutomations,
  applyDemoAccess,
  provisionDemoIdentity,
} from "./seed/lib.mjs";
import { tabModules } from "./seed/tabs/index.mjs";

const API = process.argv[2] || "http://localhost:3001";
const USER = process.argv[3] || "admin";
const PASS = process.argv[4] || "aeolus-demo-2026";

console.log(`\n🌬️  Seeding Aeolus multi-domain demo → ${API}\n`);

const { api, login } = createApi(API);

// 0. Authenticate
console.log("0. Authenticating...");
await login(USER, PASS);

// 1. Clean slate
console.log("\n1. Cleaning existing data...");
await cleanSlate(api);

// 2. Enable Data Store
console.log("\n2. Enabling Data Store...");
await enableDataStore(api);

// 3. Create automations (must exist before devices publish so state populates)
console.log("\n3. Creating automations...");
const allAutomations = tabModules.flatMap((m) => m.automations);
const idMap = await createAutomations(api, allAutomations);

// 3b. Apply per-rule public-demo access allowlists (writableStateKeys / fireEvents).
await applyDemoAccess(api, allAutomations, idMap);

// 4. Publish devices (triggers matching automations → populates live state)
console.log("\n4. Publishing devices...");
const allDevices = tabModules.flatMap((m) => m.devices);
await publishDevices(api, allDevices);

// 5. Seed Data Store collections
console.log("\n5. Seeding Data Store collections...");
for (const mod of tabModules) {
  for (const collection of mod.dataStore || []) {
    await seedCollection(api, collection);
  }
}

// 6. Build dashboard layout
console.log("\n6. Building dashboard layout...");
await buildLayout(api, tabModules, idMap);

// 7. Generate execution history
console.log("\n7. Generating execution history...");
await fireAutomations(api, Object.values(idMap), 4);

// 8. Public demo identity — only when building the public demo (opt-in), so a
// normal `make seed` on a personal install does not create a demo user/group.
if (process.env.AEOLUS_PUBLIC_DEMO === "true") {
  console.log("\n8. Provisioning public demo identity...");
  // Hybrid demo: a tab is interactive (`interact`) when any of its automations
  // declares a demo_access allowlist; otherwise it is look-only (`read`). This
  // keeps the RBAC grant in lock-step with what a tab actually exposes to demo
  // visitors — revived rich tabs (no demoAccess) are view-only, while the
  // engine-driven flagships (stage-show, spacecraft, space) allow their bounded
  // fire/state interactions.
  const tabAssignments = tabModules.map((m) => ({
    tabId: m.tab.id,
    permission: (m.automations || []).some((a) => a.demoAccess) ? "interact" : "read",
  }));
  await provisionDemoIdentity(api, tabAssignments);
  const interactive = tabAssignments.filter((t) => t.permission === "interact").map((t) => t.tabId);
  console.log(`  ✓ Interactive tabs: ${interactive.join(", ") || "(none)"}`);
}

// Done
console.log(`
✅ Multi-domain demo seeded!

   Dashboard: ${API.replace(":3001", ":3000")}
   Tabs:        ${tabModules.map((m) => m.tab.name).join(" · ")}
   Automations: ${allAutomations.length}
   Devices:     ${allDevices.length}

   Custom UI components render instantly — just open the dashboard.
`);
