// demo/seed/lib.mjs — Shared helpers for the multi-domain seed demo.
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

  /**
   * @param {object} [opts]
   * @param {number[]} [opts.tolerate] Status codes to report as `null` instead of
   *   throwing. For expected, meaningful outcomes — a 404 from deleting something
   *   that was already absent, a 409 from creating something that already exists —
   *   where the caller has a real decision to make. Never for unexpected failures.
   */
  async function request(method, path, body, { authenticated = true, retries = 6, tolerate = [] } = {}) {
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

      // A tolerated status is an answer, not a failure. Returned as null so the
      // caller can branch on it — distinguishable from a successful response,
      // which is always an object.
      if (tolerate.includes(res.status)) return null;

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

  async function api(method, path, body, { tolerate = [] } = {}) {
    return request(method, path, body, { authenticated: true, tolerate });
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

// ─── Preflight ───────────────────────────────────────────────────────────────

/**
 * Wait until the backend answers /api/health.
 *
 * `docker compose --profile seed run` starts the backend through `depends_on` but
 * does NOT wait for its healthcheck, so a cold start races the seeder. The API
 * client only retries outright connection failures three times over ~3s, which is
 * not enough for a container that is still applying migrations.
 *
 * @param {string} baseUrl
 */
export async function waitForBackend(baseUrl, { timeoutMs = 90_000, pollMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";

  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Backend not reachable at ${baseUrl} after ${Math.round(timeoutMs / 1000)}s `
        + `(last error: ${lastError}). Is the stack up? Try: docker compose up -d`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Whether the RUNNING backend actually has public-demo mode enabled.
 *
 * POST /api/auth/demo-session is mounted unconditionally but answers 404 unless
 * `config.publicDemo.enabled` (auth.routes.ts), and that config is read from the
 * environment once at module load. So the route's presence is the only way to ask a
 * live container which mode it booted in — the env of the seed container says
 * nothing about the backend's.
 *
 * Only 404 means disabled. Anything else means the route is live: before this seed
 * runs there is no `demo` user yet, so a demo-mode backend answers 401 here — which
 * is why this cannot test for a successful session, only for the route's existence.
 * A 429 from the demo-session limiter likewise means enabled.
 *
 * @param {string} baseUrl
 */
export async function backendPublicDemoEnabled(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/demo-session`, { method: "POST" });
  return res.status !== 404;
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
 * Aeolus authoring. Seed descriptors are Project-only so the showcase cannot
 * silently drift back to the removed single-file authoring contract.
 */
export async function createAutomations(api, automations) {
  const ids = {};
  for (const a of automations) {
    if (!a.projectDir) {
      throw new Error(`Seed automation "${a.name || a.key || "<unnamed>"}" is missing projectDir`);
    }
    const body = {
      name: a.name,
      ruleType: "script",
      project: loadProject(a.projectDir),
    };
    if (a.cron) {
      body.triggerType = "cron";
      body.cronExpression = a.cron;
    } else if (a.triggerTopic) {
      body.triggerType = "mqtt";
      body.triggerTopic = a.triggerTopic;
    } else {
      body.triggerType = "none";
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


// The unscoped `clearDataStore` that used to live here deleted EVERY collection and
// EVERY bucket entry on the box, which on a real install meant a reseed of the
// showcase silently destroyed the operator's own data (Req §12.1: do not delete
// unrelated user-created collections). Each showcase collection and bucket now resets
// only itself, in `seedCollection` / `seedBucket`, so the seeder's blast radius is
// exactly the fixture set it declares.

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
 * Seed one showcase collection to its declared shape, replacing whatever was there.
 *
 * Rerunnable by construction, and scoped to this one collection: it never touches a
 * collection the showcase does not declare, so a user's own collections survive a
 * reseed (Req §12.1).
 *
 * The delete comes first because a rerun must REPLACE the fixture set, not append to
 * it. There is no record-level delete in the Data Store API, so removing the
 * collection is the only way to reset its contents, and the record cascade is exactly
 * what is wanted here.
 *
 * The 409 path is the interesting one. `db.write()` auto-creates a collection, and
 * several seeded automations write to these very names — `space` on `* * * * *`,
 * `wildlife-detection` and `stage-show-sequencer` whenever the simulator publishes.
 * So a showcase automation can create the collection out from under this function
 * between the delete and the create. Ordering the Data Store ahead of automation
 * creation makes that rare rather than routine; tolerating it makes it survivable
 * either way. Failing instead is what produced
 * `POST /api/data-store/collections → 409: Collection already exists` on the Pi.
 *
 * @param {{name: string, description?: string, retentionDays?: number|null,
 *          records: {payload: object, tags?: object, timestamp?: number}[]}} collection
 */
export async function seedCollection(api, collection) {
  const name = encodeURIComponent(collection.name);
  const shape = {
    description: collection.description,
    retentionDays: collection.retentionDays ?? null,
  };

  // Absent is the normal case on a first run, so 404 is an answer rather than a fault.
  await api("DELETE", `/api/data-store/collections/${name}`, undefined, { tolerate: [404] });

  const created = await api(
    "POST",
    "/api/data-store/collections",
    { name: collection.name, ...shape },
    { tolerate: [409] },
  );

  if (created === null) {
    // An automation auto-created it in the gap. Bring the row up to the declared
    // shape rather than leaving it with the auto-create defaults — the description
    // and retention are part of what the showcase is demonstrating.
    await api("PATCH", `/api/data-store/collections/${name}`, shape);
  }

  for (const rec of collection.records) {
    await api("POST", `/api/data-store/collections/${name}/records`, {
      payload: rec.payload,
      tags: rec.tags,
      timestamp: rec.timestamp,
    });
  }
  console.log(
    `  ✓ ${collection.name}: ${collection.records.length} records${created === null ? " (adopted an auto-created collection)" : ""}`,
  );
}

/**
 * Seed a key/value bucket. Buckets are shared persistent state, so demo buckets
 * are defined globally rather than pretending they belong to one dashboard tab.
 * @param {{name:string, entries:Record<string, unknown>}} bucket
 */
export async function seedBucket(api, bucket) {
  const name = encodeURIComponent(bucket.name);

  // Drop the keys this bucket already holds before writing the declared set.
  // `PUT` upserts, so a rerun would otherwise leave behind keys from an older
  // showcase revision — present, stale, and indistinguishable from current ones.
  // Scoped to this bucket, so buckets the showcase does not declare are untouched.
  const existing = await api("GET", `/api/data-store/buckets/${name}`, undefined, { tolerate: [404] });
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (!entry || typeof entry.key !== "string") continue;
      await api(
        "DELETE",
        `/api/data-store/buckets/${name}/${encodeURIComponent(entry.key)}`,
        undefined,
        { tolerate: [404] },
      );
    }
  }

  let count = 0;
  for (const [key, value] of Object.entries(bucket.entries || {})) {
    const result = await api("PUT", `/api/data-store/buckets/${name}/${encodeURIComponent(key)}`, { value });
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
