// scripts/seed/lib.mjs — Shared helpers for the multi-domain seed demo.
//
// Provides an authenticated API client plus high-level helpers for cleaning,
// publishing devices, creating automations, seeding the Data Store, building
// the dashboard layout, and generating execution history. Tab modules stay
// declarative — all the HTTP plumbing lives here.

/**
 * Create an authenticated API client bound to a base URL.
 * @param {string} baseUrl - e.g. "http://localhost:3001"
 */
export function createApi(baseUrl) {
  let token = null;

  async function api(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`  ✗ ${method} ${path} → ${res.status}`, data);
      return null;
    }
    return data;
  }

  /** Authenticate against an already-set-up admin account. Exits on failure. */
  async function login(username, password) {
    const status = await fetch(`${baseUrl}/api/auth/status`)
      .then((r) => r.json())
      .catch(() => ({}));
    if (status.needsSetup) {
      console.error("  ✗ Admin account not set up yet.");
      console.error("    Create your admin account in the dashboard first, then re-run:");
      console.error(`    node scripts/seed-demo.mjs ${baseUrl} <username> <password>`);
      process.exit(1);
    }
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`  ✗ Login failed for "${username}".`);
      console.error("    Usage: node scripts/seed-demo.mjs [url] [username] [password]");
      process.exit(1);
    }
    token = data.accessToken;
    console.log(`  ✓ Logged in as ${username}`);
  }

  return { api, login };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Clean-slate reset: delete every automation and clear the dashboard layout.
 *
 * The demo seed defines the entire dashboard, so it owns the full layout +
 * automation set. (There is no per-automation "seed" metadata flag to filter
 * on, so this deletes all automations — use `make reset` for a full DB wipe.)
 */
export async function cleanSlate(api) {
  const existing = await api("GET", "/api/automations");
  if (Array.isArray(existing) && existing.length > 0) {
    for (const rule of existing) {
      await api("DELETE", `/api/automations/${rule.id}`);
    }
    console.log(`  ✓ Deleted ${existing.length} existing automations`);
  }
  await api("PUT", "/api/layout", { tabs: [], panes: [] });
  console.log("  ✓ Cleared dashboard layout");
}

// ─── Devices ─────────────────────────────────────────────────────────────────

/**
 * Publish initial device state via MQTT. Devices auto-register on first message.
 * @param {{topic: string, payload: object}[]} devices
 */
export async function publishDevices(api, devices) {
  for (const d of devices) {
    await api("POST", "/api/mqtt/publish", {
      topic: d.topic,
      payload: typeof d.payload === "string" ? d.payload : JSON.stringify(d.payload),
    });
  }
  // Give the broker + registry a moment to ingest before automations run.
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`  ✓ Published ${devices.length} device messages`);
}

// ─── Automations ─────────────────────────────────────────────────────────────

/**
 * Create script automations. Returns a map of { key → ruleId } so layout
 * panes can reference automations by their stable module key.
 *
 * Each automation: { key, name, scriptSource, uiSource?, and EITHER
 *   triggerTopic (MQTT) OR cron (cron expression) }.
 * @param {{key: string, name: string, triggerTopic?: string, cron?: string, scriptSource: string, uiSource?: string}[]} automations
 */
export async function createAutomations(api, automations) {
  const ids = {};
  for (const a of automations) {
    const body = {
      name: a.name,
      ruleType: "script",
      scriptSource: a.scriptSource,
      uiSource: a.uiSource || undefined,
    };
    if (a.cron) {
      body.triggerType = "cron";
      body.cronExpression = a.cron;
    } else {
      body.triggerTopic = a.triggerTopic || "none";
    }
    const created = await api("POST", "/api/automations", body);
    if (created) {
      ids[a.key] = created.id;
      console.log(`  ✓ ${a.name}`);
    }
  }
  return ids;
}

/** Fire each automation a few times to populate execution history. */
export async function fireAutomations(api, ruleIds, times = 4) {
  for (const id of ruleIds) {
    for (let i = 0; i < times; i++) {
      await api("POST", `/api/automations/${id}/fire`);
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  console.log(`  ✓ Fired ${ruleIds.length} automations × ${times}`);
}

// ─── Data Store ──────────────────────────────────────────────────────────────

/** Enable the Data Store with generous demo limits (idempotent). */
export async function enableDataStore(api) {
  await api("POST", "/api/data-store/enable", {
    maxStorageMb: 200,
    maxRecordsPerCollection: 100_000,
    maxCollections: 100,
  });
  console.log("  ✓ Data Store enabled");
}

/**
 * Create a collection and bulk-write its records (with backdated timestamps).
 * @param {{name: string, description?: string, retentionDays?: number|null,
 *          records: {payload: object, tags?: object, timestamp?: number}[]}} collection
 */
export async function seedCollection(api, collection) {
  await api("POST", "/api/data-store/collections", {
    name: collection.name,
    description: collection.description,
    retentionDays: collection.retentionDays ?? null,
  });
  for (const rec of collection.records) {
    await api("POST", `/api/data-store/collections/${collection.name}/records`, {
      payload: rec.payload,
      tags: rec.tags,
      timestamp: rec.timestamp,
    });
  }
  console.log(`  ✓ ${collection.name}: ${collection.records.length} records`);
}

/**
 * Generate a backdated time-series. Returns records spaced `intervalMs` apart
 * ending at `end`, with each field computed by a generator fn(step, timestamp).
 * @param {{count: number, intervalMs: number, end?: number,
 *          fields: Record<string, (step: number, t: number) => unknown>,
 *          tags?: object}} opts
 */
export function genSeries({ count, intervalMs, end = Date.now(), fields, tags }) {
  const records = [];
  for (let i = 0; i < count; i++) {
    const timestamp = end - (count - 1 - i) * intervalMs;
    const payload = {};
    for (const [name, fn] of Object.entries(fields)) {
      payload[name] = fn(i, timestamp);
    }
    records.push(tags ? { payload, tags, timestamp } : { payload, timestamp });
  }
  return records;
}

/** Small helpers for realistic-looking series. */
export const noise = (amplitude) => (Math.random() - 0.5) * 2 * amplitude;
export const round = (n, dp = 1) => Number(n.toFixed(dp));

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * Build and persist the dashboard layout from declarative tab modules.
 *
 * Each tab module exposes `panes` referencing automations by their module key.
 * This resolves those keys to the real rule IDs produced by createAutomations.
 *
 * Pane spec shapes:
 *   { kind: "device-grid", x, y, w, h }
 *   { kind: "automation", ref: "<automation key>", x, y, w, h }
 *
 * @param {{tab: {id, name, icon}, panes: object[]}[]} tabModules
 * @param {Record<string, string>} idMap - automation key → ruleId
 */
export async function buildLayout(api, tabModules, idMap) {
  const now = new Date().toISOString();
  const tabs = [];
  const panes = [];

  tabModules.forEach((mod, tabIndex) => {
    tabs.push({
      id: mod.tab.id,
      name: mod.tab.name,
      icon: mod.tab.icon,
      order: tabIndex,
      createdAt: now,
    });

    mod.panes.forEach((p, paneIndex) => {
      const base = {
        id: `${mod.tab.id}-pane-${paneIndex}`,
        tabId: mod.tab.id,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        createdAt: now,
      };
      if (p.kind === "device-grid") {
        panes.push({ ...base, paneType: "device-grid", config: {} });
      } else if (p.kind === "automation") {
        const automation = mod.automations.find((a) => a.key === p.ref);
        panes.push({
          ...base,
          paneType: "automation",
          config: { ruleId: idMap[p.ref] || "", ruleName: automation?.name || "" },
        });
      }
    });
  });

  await api("PUT", "/api/layout", { tabs, panes });
  console.log(`  ✓ Layout: ${tabs.length} tabs, ${panes.length} panes`);
}
