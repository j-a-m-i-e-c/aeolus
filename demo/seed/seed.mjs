#!/usr/bin/env node
/**
 * demo/seed/seed.mjs — Populate Aeolus with the multi-domain showcase.
 *
 * Showcases the platform across distinct deployment domains — agriculture,
 * wildlife, research vessel, underground mining, escape room, stage/show,
 * off-grid shelter, and live space data — proving the core abstractions are
 * domain-agnostic without forcing every use case into the same UI shape.
 *
 * Each tab lives in its own module under demo/seed/tabs/. This orchestrator
 * wires them together: clean → automations → devices → data store → layout.
 *
 * Usage:
 *   node demo/seed/seed.mjs [url] [username] [password]
 * Example:
 *   node demo/seed/seed.mjs http://localhost:3001 admin mypass
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
  waitForBackend,
  backendPublicDemoEnabled,
} from "./lib.mjs";
import { tabModules } from "./tabs/index.mjs";
import { demoBuckets } from "./data-store-buckets.mjs";
import {
  createBootstrapClient,
  configureSimulatedCommandProfiles,
} from "./simulator-bootstrap.mjs";
import { AGRICULTURE_ACTUATOR_SPECS } from "./agriculture-simulator-bootstrap.mjs";
import { RESEARCH_VESSEL_ACTUATOR_SPECS } from "./research-vessel-simulator-bootstrap.mjs";
import { UNDERGROUND_MINING_ACTUATOR_SPECS } from "./underground-mining-simulator-bootstrap.mjs";
import { WILDLIFE_ACTUATOR_SPECS } from "./wildlife-simulator-bootstrap.mjs";
import { STAGE_SHOW_ACTUATOR_SPECS } from "./stage-show-simulator-bootstrap.mjs";
import { ESCAPE_ROOM_ACTUATOR_SPECS } from "./escape-room-simulator-bootstrap.mjs";
import { OFF_GRID_BUNKER_ACTUATOR_SPECS } from "./off-grid-bunker-simulator-bootstrap.mjs";

const API = process.argv[2] || "http://localhost:3001";
const USER = process.argv[3] || "admin";
const PASS = process.argv[4];

// No default password. On a pristine database step 0 CREATES the admin with
// whatever it is given, so a fallback here would quietly provision a real install
// with a password that is public in this repo.
if (!PASS) {
  console.error("Error: an admin password is required.\n");
  console.error("  make seed PASS=<password> [USER=admin]        # normal install");
  console.error("  make seed-demo PASS=<password> [USER=admin]   # public demo\n");
  console.error(`  node demo/seed/seed.mjs ${API} ${USER} <password>`);
  process.exit(1);
}

const WANT_PUBLIC_DEMO = process.env.AEOLUS_PUBLIC_DEMO === "true";
const WANT_SIMULATOR = process.env.AEOLUS_SIMULATOR_BOOTSTRAP === "true";

console.log(`\n🌬️  Seeding Aeolus multi-domain demo → ${API}\n`);

const { api, login } = createApi(API);

// 0. Wait for the backend, then authenticate. `docker compose run` starts the
// backend via depends_on but does not wait for its healthcheck.
console.log("0. Waiting for the backend...");
await waitForBackend(API);
console.log("  ✓ Backend is answering /api/health");
await login(USER, PASS);

// 0b. Preflight the demo-mode contract BEFORE the clean slate below destroys
// anything. Public-demo mode is read from the environment once at backend boot, and
// the base compose file does not declare AEOLUS_PUBLIC_DEMO at all — it arrives only
// with demo/compose/local-showcase.yml. Because `compose run` does not recreate an
// already-running backend, seeding the demo against a stack started by `make up`
// used to succeed while leaving the running server in normal mode: the demo group,
// user and per-rule allowlists all existed, but /api/auth/demo-session was 404 and
// the frontend bundle had no VITE_PUBLIC_DEMO. That is the state people were fixing
// by hand with a rebuild. Now it is a refusal, before any data is touched.
if (WANT_PUBLIC_DEMO) {
  const live = await backendPublicDemoEnabled(API);
  if (!live) {
    console.error("\n✗ This seed provisions the PUBLIC DEMO, but the running backend is in normal mode.");
    console.error("  /api/auth/demo-session answers 404, so AEOLUS_PUBLIC_DEMO was not set when it booted.");
    console.error("  Nothing has been changed.\n");
    console.error("  Start the stack with the demo overlay, then seed again:");
    console.error("    make demo-up");
    console.error("    make seed-demo PASS=<password>\n");
    console.error("  demo-up is also what bakes VITE_PUBLIC_DEMO into the frontend image, which a");
    console.error("  restart alone cannot do — it is a build argument.");
    process.exit(1);
  }
  console.log("  ✓ Backend confirms public-demo mode is live");
}

// 1. Clean slate
console.log("\n1. Cleaning existing data...");
await cleanSlate(api);

// 2. Enable + reset Data Store. The seeder is a whole-demo rebuild, so stale
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
if (WANT_PUBLIC_DEMO) {
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
if (WANT_SIMULATOR) {
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
    // The simulator publishes device state RETAINED, so the backend learns about the
    // simulated actuators when the simulator connects — or on its own restart, by
    // re-reading the broker's retained store. `docker compose down -v` deletes that
    // store along with everything else, so after a full wipe nothing will arrive
    // until the simulator reconnects, and waiting longer cannot help.
    console.error("    The simulator publishes its device state retained, so the backend only sees");
    console.error("    those devices after the simulator connects. If the broker volume was wiped");
    console.error("    (docker compose down -v), make it republish and seed again:");
    console.error("      make demo-reset");
    console.error("      make seed-demo PASS=<password>");
    throw err;
  }
}

const finalAutomations = await api("GET", "/api/automations");
const finalDevices = await api("GET", "/api/devices");
if (!Array.isArray(finalAutomations) || finalAutomations.length !== allAutomations.length) {
  throw new Error(`Seed verification failed: expected ${allAutomations.length} automations, found ${Array.isArray(finalAutomations) ? finalAutomations.length : "invalid response"}`);
}
if (WANT_SIMULATOR && (!Array.isArray(finalDevices) || finalDevices.length === 0)) {
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
