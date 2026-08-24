#!/usr/bin/env node
/**
 * seed-demo.mjs — Populate Aeolus with the multi-domain demo.
 *
 * Showcases the platform across distinct deployment domains — agriculture,
 * wildlife, research vessel, underground mining, escape room, stage/show,
 * off-grid continuity, and live space data — proving the core abstractions are
 * domain-agnostic without forcing every use case into the same UI shape.
 *
 * Each tab lives in its own module under scripts/seed/tabs/. This orchestrator
 * wires them together: clean → automations → devices → data store → layout.
 *
 * Usage:
 *   node scripts/seed-demo.mjs [url] [username] [password]
 * Example:
 *   node scripts/seed-demo.mjs http://localhost:3001 admin mypass
 *
 * Prerequisites: Aeolus running. On a pristine database the supplied admin
 * credentials are used to create the initial administrator automatically.
 */

import {
  createApi,
  cleanSlate,
  enableDataStore,
  clearDataStore,
  publishDevices,
  createAutomations,
  seedCollection,
  seedBucket,
  buildLayout,
  fireAutomations,
  applyDemoAccess,
  provisionDemoIdentity,
} from "./seed/lib.mjs";
import { tabModules } from "./seed/tabs/index.mjs";
import { demoBuckets } from "./seed/data-store-buckets.mjs";
import {
  createBootstrapClient,
  configureSimulatedCommandProfiles,
} from "./seed/simulator-bootstrap.mjs";
import { AGRICULTURE_ACTUATOR_SPECS } from "./seed/agriculture-simulator-bootstrap.mjs";
import { RESEARCH_VESSEL_ACTUATOR_SPECS } from "./seed/research-vessel-simulator-bootstrap.mjs";
import { UNDERGROUND_MINING_ACTUATOR_SPECS } from "./seed/underground-mining-simulator-bootstrap.mjs";
import { WILDLIFE_ACTUATOR_SPECS } from "./seed/wildlife-simulator-bootstrap.mjs";
import { STAGE_SHOW_ACTUATOR_SPECS } from "./seed/stage-show-simulator-bootstrap.mjs";
import { ESCAPE_ROOM_ACTUATOR_SPECS } from "./seed/escape-room-simulator-bootstrap.mjs";
import { OFF_GRID_BUNKER_ACTUATOR_SPECS } from "./seed/off-grid-bunker-simulator-bootstrap.mjs";

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

// 2. Enable + reset Data Store. seed-demo is a whole-demo rebuild, so stale
// records from older showcase revisions should never accumulate invisibly.
console.log("\n2. Preparing Data Store...");
await enableDataStore(api);
await clearDataStore(api);

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

// 5b. Seed shared key/value buckets. Buckets are intentionally global in the
// current Data Store model, so they are showcase examples rather than tab-owned
// coordination state.
console.log("\n5b. Seeding Data Store buckets...");
for (const bucket of demoBuckets) {
  await seedBucket(api, bucket);
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
  // engine-driven flagships (stage-show, space) allow their bounded
  // fire/state interactions.
  const tabAssignments = tabModules.map((m) => ({
    tabId: m.tab.id,
    permission: (m.automations || []).some((a) => a.demoAccess) ? "interact" : "read",
  }));
  await provisionDemoIdentity(api, tabAssignments);
  const interactive = tabAssignments.filter((t) => t.permission === "interact").map((t) => t.tabId);
  console.log(`  ✓ Interactive tabs: ${interactive.join(", ") || "(none)"}`);
}

// 9. Phase 2 simulator bootstrap — configure the simulated actuators' MQTT
// command profiles through the normal API once the simulator has published its
// devices. Opt-in (only when a simulator is running alongside), so a normal
// `make seed` on a personal install is unaffected.
if (process.env.AEOLUS_SIMULATOR_BOOTSTRAP === "true") {
  console.log("\n9. Configuring simulated-hardware command profiles...");
  try {
    const bootstrapClient = createBootstrapClient(api);
    const { configured, skipped } = await configureSimulatedCommandProfiles(
      bootstrapClient,
      [...AGRICULTURE_ACTUATOR_SPECS, ...RESEARCH_VESSEL_ACTUATOR_SPECS, ...UNDERGROUND_MINING_ACTUATOR_SPECS, ...WILDLIFE_ACTUATOR_SPECS, ...STAGE_SHOW_ACTUATOR_SPECS, ...ESCAPE_ROOM_ACTUATOR_SPECS, ...OFF_GRID_BUNKER_ACTUATOR_SPECS],
      { timeoutMs: 30000, pollMs: 1000 },
    );
    console.log(`  ✓ Simulated actuators — configured: ${configured.length}, already-current: ${skipped.length}`);
  } catch (err) {
    console.error(`  ✗ Simulator bootstrap failed: ${err.message}`);
    console.error("    Ensure the simulator service is running and has published its devices.");
    throw err;
  }
}

const finalAutomations = await api("GET", "/api/automations");
const finalDevices = await api("GET", "/api/devices");
if (!Array.isArray(finalAutomations) || finalAutomations.length !== allAutomations.length) {
  throw new Error(`Seed verification failed: expected ${allAutomations.length} automations, found ${Array.isArray(finalAutomations) ? finalAutomations.length : "invalid response"}`);
}
if (process.env.AEOLUS_SIMULATOR_BOOTSTRAP === "true" && (!Array.isArray(finalDevices) || finalDevices.length === 0)) {
  throw new Error("Seed verification failed: simulator bootstrap is enabled but no devices are registered");
}

console.log(`
✅ Multi-domain demo seeded and verified!

   Dashboard: ${API.replace(":3001", ":3000")}
   Tabs:        ${tabModules.map((m) => m.tab.name).join(" · ")}
   Automations: ${finalAutomations.length}
   Devices:     ${Array.isArray(finalDevices) ? finalDevices.length : allDevices.length}

   Custom UI components render instantly — just open the dashboard.
`);
