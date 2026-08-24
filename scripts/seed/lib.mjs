// scripts/seed/lib.mjs — Shared helpers for the multi-domain seed demo.
//
// Provides an authenticated API client plus high-level helpers for cleaning,
// publishing devices, creating automations, seeding the Data Store, building
// the dashboard layout, and generating execution history. Tab modules stay
// declarative — all the HTTP plumbing lives here.

// Project source loading is shared with the showcase architecture tests so the
// tree layout and entry resolution are defined in exactly one place.
import { loadProject } from "./project-loader.mjs";

/**
 * Create an authenticated API client bound to a base URL.
 * @param {string} baseUrl - e.g. "http://localhost:3001"
 */
export function createApi(baseUrl) {
  let token = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function retryDelayMs(res, attempt) {
    const retryAfter = Number(res.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    const reset = Number(res.headers.get("ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return reset * 1000;
    return Math.min(1000 * (2 ** attempt), 15_000);
  }

  async function request(method, path, body, { authenticated = true, retries = 6 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const headers = { "Content-Type": "application/json" };
      if (authenticated && token) headers.Authorization = `Bearer ${token}`;
      const opts = { method, headers };
      if (body !== undefined) opts.body = JSON.stringify(body);

      let res;
      try {
        res = await fetch(`${baseUrl}${path}`, opts);
      } catch (err) {
        if (attempt >= 3) throw err;
        const delay = Math.min(500 * (2 ** attempt), 3000);
        console.warn(`  ↻ ${method} ${path} connection failed; retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;

      if (res.status === 429 && attempt < retries) {
        const delay = retryDelayMs(res, attempt);
        console.warn(`  ↻ ${method} ${path} rate-limited; retrying in ${Math.ceil(delay / 1000)}s`);
        await sleep(delay + 100);
        continue;
      }

      const detail = data && typeof data === "object" && "error" in data
        ? String(data.error)
        : `HTTP ${res.status}`;
      throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
    }
  }

  async function api(method, path, body) {
    return request(method, path, body, { authenticated: true });
  }

  /** Authenticate an admin, creating the first admin on a pristine database. */
  async function login(username, password) {
    const status = await request("GET", "/api/auth/status", undefined, { authenticated: false });
    if (status.needsSetup) {
      const setup = await request("POST", "/api/auth/setup", { username, password }, { authenticated: false, retries: 2 });
      if (!setup?.accessToken) throw new Error("Initial admin setup returned no access token");
      token = setup.accessToken;
      console.log(`  ✓ Created initial admin account and logged in as ${username}`);
      return;
    }
    const data = await request("POST", "/api/auth/login", { username, password }, { authenticated: false, retries: 2 });
    if (!data?.accessToken) throw new Error(`Login for "${username}" returned no access token`);
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
 * Demo automations use the same multi-file Automation Project model as normal
 * Aeolus authoring. Legacy scriptSource/uiSource descriptors are still accepted
 * so older third-party seed modules remain compatible.
 */
export async function createAutomations(api, automations) {
  const ids = {};
  for (const a of automations) {
    const body = {
      name: a.name,
      ruleType: "script",
      ...(a.projectDir
        ? { project: loadProject(a.projectDir) }
        : { scriptSource: a.scriptSource, uiSource: a.uiSource || undefined }),
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


/**
 * Clear every Data Store collection and bucket entry.
 *
 * `seed-demo.mjs` is already a destructive whole-demo rebuild (it deletes all
 * automations and replaces the layout), so keeping the Data Store deterministic
 * is safer than accumulating records from previous demo revisions. This is a
 * seed/deployment concern — it is deliberately not exposed as a public-demo UI
 * button where one visitor could erase shared state for everyone else.
 */
export async function clearDataStore(api) {
  const collections = await api("GET", "/api/data-store/collections");
  let deletedCollections = 0;
  if (Array.isArray(collections)) {
    for (const collection of collections) {
      if (!collection || typeof collection.name !== "string") continue;
      const result = await api("DELETE", `/api/data-store/collections/${encodeURIComponent(collection.name)}`);
      if (result) deletedCollections += 1;
    }
  }

  const buckets = await api("GET", "/api/data-store/buckets");
  let deletedBucketEntries = 0;
  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      if (!bucket || typeof bucket.bucket !== "string") continue;
      const entries = await api("GET", `/api/data-store/buckets/${encodeURIComponent(bucket.bucket)}`);
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry.key !== "string") continue;
        const result = await api(
          "DELETE",
          `/api/data-store/buckets/${encodeURIComponent(bucket.bucket)}/${encodeURIComponent(entry.key)}`,
        );
        if (result) deletedBucketEntries += 1;
      }
    }
  }

  console.log(`  ✓ Data Store reset: ${deletedCollections} collections, ${deletedBucketEntries} bucket entries removed`);
}

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
 * Seed a key/value bucket. Buckets are shared persistent state, so demo buckets
 * are defined globally rather than pretending they belong to one dashboard tab.
 * @param {{name:string, entries:Record<string, unknown>}} bucket
 */
export async function seedBucket(api, bucket) {
  let count = 0;
  for (const [key, value] of Object.entries(bucket.entries || {})) {
    const result = await api(
      "PUT",
      `/api/data-store/buckets/${encodeURIComponent(bucket.name)}/${encodeURIComponent(key)}`,
      { value },
    );
    if (result) count += 1;
  }
  console.log(`  ✓ ${bucket.name}: ${count} bucket entries`);
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

// ─── Public demo identity ────────────────────────────────────────────────────

/**
 * Provision the public-demo identity: a `Public Demo` group holding per-tab
 * `read`/`interact` grants, and a `demo` user in that group.
 *
 * The hybrid demo mixes look-only tabs (`read`) with a few interactive flagship
 * tabs (`interact`). Interactivity is enforced by RBAC: `POST /:id/fire` and
 * `PUT /:id/state` require `interact`, so a `read` tab is view-only server-side
 * regardless of the frontend. Callers pass the per-tab assignments directly
 * (derive `interact` for tabs whose automations declare `demoAccess`).
 *
 * The public demo authenticates via POST /api/auth/demo-session (token minted
 * server-side), so the demo user's password is never used for login — a strong
 * random password is set purely to satisfy user creation. Idempotent: skips
 * creation when the group/user already exist.
 *
 * @param {(m:string,p:string,b?:object)=>Promise<any>} api - authed admin API caller
 * @param {{tabId:string, permission:"read"|"interact"|"write"}[]} tabAssignments - per-tab grants
 */
export async function provisionDemoIdentity(api, tabAssignments) {
  const groups = (await api("GET", "/api/auth/groups")) || [];
  let group = Array.isArray(groups) ? groups.find((g) => g.name === "Public Demo") : null;

  if (!group) {
    group = await api("POST", "/api/auth/groups", { name: "Public Demo", tabAssignments });
    console.log("  ✓ Created 'Public Demo' group");
  } else {
    await api("PUT", `/api/auth/groups/${group.id}`, { name: "Public Demo", tabAssignments });
    console.log("  ✓ Updated 'Public Demo' group tab permissions");
  }

  const groupId = group?.id;
  const users = (await api("GET", "/api/auth/users")) || [];
  const existing = Array.isArray(users) ? users.find((u) => u.username === "demo") : null;
  if (!existing) {
    // Random, unused password — the demo signs in via the demo-session endpoint.
    const randomPassword = `demo-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    await api("POST", "/api/auth/users", {
      username: "demo",
      password: randomPassword,
      groupId,
      role: "user",
    });
    console.log("  ✓ Created 'demo' user (role: user)");
  } else {
    console.log("  ✓ 'demo' user already exists");
  }
}

/**
 * Apply per-rule public-demo access allowlists. For each automation that
 * declares `demoAccess: { writableStateKeys?, fireEvents? }`, PATCH the rule's
 * demo_access via the admin endpoint so public-demo visitors can only write
 * declared state keys and fire declared events.
 *
 * @param {(m:string,p:string,b?:object)=>Promise<any>} api - authed admin API caller
 * @param {{key:string, demoAccess?:{writableStateKeys?:string[], fireEvents?:string[]}}[]} automations
 * @param {Record<string,string>} idMap - automation key → ruleId
 */
export async function applyDemoAccess(api, automations, idMap) {
  let count = 0;
  for (const a of automations) {
    if (!a.demoAccess) continue;
    const ruleId = idMap[a.key];
    if (!ruleId) continue;
    await api("PATCH", `/api/automations/${ruleId}/demo-access`, a.demoAccess);
    count++;
  }
  if (count > 0) console.log(`  ✓ Applied demo access to ${count} automations`);
}
