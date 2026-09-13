// demo/seed/lib.mjs — Shared helpers for the multi-domain seed demo.
//
// Provides an authenticated API client plus high-level helpers for cleaning,
// publishing devices, creating automations, seeding the Data Store, building
// the dashboard layout, and generating execution history. Tab modules stay
// declarative — all the HTTP plumbing lives here.

// Project source loading is shared with the showcase architecture tests so the
// tree layout and entry resolution are defined in exactly one place.
import { loadProject } from "./project-loader.mjs";
import { parseShowcaseLayout } from "./layouts/index.mjs";

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
      console.log(`  ✓ Created the initial admin account, named "${username}", and logged in`);
      return;
    }

    let data;
    try {
      data = await request("POST", "/api/auth/login", { username, password }, { authenticated: false, retries: 2 });
    } catch (err) {
      // The make targets default USER to "admin", which is only right for an install
      // this seeder set up itself — the branch above creates an account with that
      // literal name. `setupAdmin` stores whatever username the first-run Setup page
      // was given, so anyone who created their admin in the browser has a different
      // one and lands here. A bare "→ 401" points at the password and never at the
      // username, which is the likelier cause of the two.
      if (err instanceof Error && / → 401\b/.test(err.message)) {
        throw new Error(
          `Could not log in as "${username}". Either the password is wrong, or that `
          + `account does not exist.\n\n`
          + `  There is no guarantee your admin is called "admin". The first-run Setup `
          + `page stores\n  whatever username you typed, and the make targets only `
          + `default to "admin" because that\n  is the name they use when they create `
          + `the account themselves.\n\n`
          + `  Pass yours on the command line (it must be inline — an exported USER is `
          + `ignored):\n`
          + `      make <target> PASS=<password> USER=<your-username>`,
        );
      }
      throw err;
    }

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

// ─── Showcase ownership ledger ───────────────────────────────────────────────

/**
 * The bucket recording what this seeder created, so a rerun can reclaim its own
 * resources and nothing else (Req §12.1, §12.2).
 *
 * Why a ledger is needed at all. Automations get server-generated ids and carry no
 * ownership column, so once `POST /api/automations` returns there is nothing on the
 * row connecting it back to the `farm-water` key in demo/seed/tabs/. The old
 * `cleanSlate` resolved that by deleting EVERY automation and clearing the WHOLE
 * dashboard, which meant reseeding the showcase destroyed any automation or tab you
 * had authored yourself.
 *
 * §12.2 offers two ways out: seed metadata on each resource, or a ledger keyed by
 * stable id. The ledger is the one that needs no migration and no new API surface —
 * the Data Store already exists, the seeder already owns fixtures in it, and a bucket
 * is precisely a map of `stable module key → server-generated id`.
 *
 * It is deliberately visible in the Data Store UI, next to the platform's own
 * `_metrics:*` collections. Anyone wondering what the showcase claims can read it.
 */
export const SHOWCASE_LEDGER_BUCKET = "_showcase:seed-ledger";

const LEDGER_AUTOMATION_PREFIX = "automation:";
const LEDGER_TAB_PREFIX = "tab:";

const ledgerBucketPath = () => `/api/data-store/buckets/${encodeURIComponent(SHOWCASE_LEDGER_BUCKET)}`;
const ledgerKeyPath = (key) => `${ledgerBucketPath()}/${encodeURIComponent(key)}`;

/**
 * Read the ledger: which automations and tabs the last seed run created.
 *
 * `existed: false` means this install has never been seeded by a ledger-aware seeder.
 * That covers two cases which are indistinguishable from here — a genuinely first
 * run, and an install seeded by an older revision that left showcase automations
 * behind without recording them. Both are handled the same way, by the one-time
 * adoption pass in `reconcileShowcaseAutomations`.
 *
 * Requires the Data Store to be enabled, which is why the seeder enables it before
 * reconciling rather than as part of seeding fixtures.
 */
export async function readShowcaseLedger(api) {
  const entries = await api("GET", ledgerBucketPath(), undefined, { tolerate: [404] });
  const automations = new Map();
  const tabIds = [];

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry.key !== "string") continue;
      if (entry.key.startsWith(LEDGER_AUTOMATION_PREFIX)) {
        // A non-string value means a corrupted entry rather than a rule id. Skipping
        // it costs one orphaned automation; trusting it would send a junk id into a
        // DELETE path.
        if (typeof entry.value !== "string" || entry.value.length === 0) continue;
        automations.set(entry.key.slice(LEDGER_AUTOMATION_PREFIX.length), entry.value);
      } else if (entry.key.startsWith(LEDGER_TAB_PREFIX)) {
        tabIds.push(entry.key.slice(LEDGER_TAB_PREFIX.length));
      }
    }
  }

  return { existed: automations.size > 0 || tabIds.length > 0, automations, tabIds };
}

/**
 * Record one automation in the ledger, immediately after it is created.
 *
 * Per-automation rather than one bulk write at the end, because staying true through
 * a partial failure is the ledger's whole job. A seed that dies midway through
 * creating automations leaves the ledger naming exactly the rules that do exist, so
 * the next run reclaims them instead of orphaning them and adding a second copy.
 */
export async function recordShowcaseAutomation(api, key, ruleId) {
  await api("PUT", ledgerKeyPath(LEDGER_AUTOMATION_PREFIX + key), { value: ruleId });
}

/**
 * Record which tabs the showcase owns, and release the ones it no longer declares.
 *
 * Releasing matters for the layout merge: a tab dropped from demo/seed/tabs/ would
 * otherwise look like a tab you authored and be preserved forever. The ledger is what
 * makes "the showcase used to own this" expressible at all.
 */
export async function recordShowcaseTabs(api, declaredTabIds, previousTabIds = []) {
  for (const tabId of declaredTabIds) {
    await api("PUT", ledgerKeyPath(LEDGER_TAB_PREFIX + tabId), { value: true });
  }
  const declared = new Set(declaredTabIds);
  for (const tabId of previousTabIds) {
    if (declared.has(tabId)) continue;
    await api("DELETE", ledgerKeyPath(LEDGER_TAB_PREFIX + tabId), undefined, { tolerate: [404] });
  }
}

// ─── Reconcile ───────────────────────────────────────────────────────────────

/**
 * Reclaim the previous showcase automations, and only those.
 *
 * Removal is by ledger id, which is exact. The one exception is the adoption pass for
 * a pre-ledger install: with no ledger there is nothing but the display name to go on,
 * so rules whose name exactly matches one the showcase declares are adopted and
 * replaced. §12.2 says not to infer ownership from a display name *when a stable id
 * exists* — here none does, which is the situation the ledger is being introduced to
 * end. It happens once, it is bounded to the exact set of names in demo/seed/tabs/,
 * and every adoption is printed so it is visible rather than silent.
 *
 * The residual risk is an automation you named exactly "Water Management" on an
 * install that predates the ledger. After this run the ledger exists and name
 * matching never happens again.
 *
 * @param {{key: string, name: string}[]} declared - the showcase's own automations
 * @returns {Promise<{reclaimed: number, adopted: number, preserved: number}>}
 */
export async function reconcileShowcaseAutomations(api, declared) {
  const ledger = await readShowcaseLedger(api);
  const live = await api("GET", "/api/automations");
  const liveRules = Array.isArray(live) ? live : [];
  const liveIds = new Set(liveRules.map((rule) => rule?.id).filter(Boolean));

  // ruleId → why it is being removed. A Map so a rule named in the ledger AND
  // matching by name is only deleted once.
  const doomed = new Map();
  for (const ruleId of ledger.automations.values()) {
    if (liveIds.has(ruleId)) doomed.set(ruleId, "ledger");
  }

  let adopted = 0;
  if (!ledger.existed) {
    const declaredNames = new Set(declared.map((a) => a.name).filter(Boolean));
    for (const rule of liveRules) {
      if (!rule?.id || doomed.has(rule.id)) continue;
      if (!declaredNames.has(rule.name)) continue;
      doomed.set(rule.id, "name");
      adopted += 1;
      console.log(`  · Adopting pre-ledger showcase automation "${rule.name}"`);
    }
  }

  for (const ruleId of doomed.keys()) {
    // Tolerated: a rule the ledger names may have been deleted by hand since.
    await api("DELETE", `/api/automations/${ruleId}`, undefined, { tolerate: [404] });
  }

  // Clear every automation entry, including ones whose rule was already gone, so the
  // ledger reflects only what step 3 is about to create.
  for (const key of ledger.automations.keys()) {
    await api("DELETE", ledgerKeyPath(LEDGER_AUTOMATION_PREFIX + key), undefined, { tolerate: [404] });
  }

  const preserved = liveRules.length - doomed.size;
  console.log(
    `  ✓ Reclaimed ${doomed.size} showcase automation(s)`
    + (adopted > 0 ? ` — ${adopted} adopted by name on a pre-ledger install` : ""),
  );
  console.log(
    preserved > 0
      ? `  ✓ Left ${preserved} automation(s) you authored untouched`
      : "  ✓ No other automations on this install",
  );

  return { reclaimed: doomed.size, adopted, preserved };
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
 *
 * Each created rule is written to the showcase ledger straight away, before the next
 * one is created. That is what lets a later rerun reclaim exactly these rules instead
 * of deleting every automation on the box — see SHOWCASE_LEDGER_BUCKET.
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
      // Recorded before the loop continues, so an abort here still leaves the ledger
      // naming every rule that actually exists.
      await recordShowcaseAutomation(api, a.key, created.id);
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
 * Build and persist the dashboard layout from declarative tab modules, preserving
 * tabs you authored yourself.
 *
 * Each tab module exposes `panes` referencing automations by their module key.
 * This resolves those keys to the real rule IDs produced by createAutomations.
 *
 * Pane spec shapes:
 *   { kind: "device-grid", x, y, w, h }
 *   { kind: "automation", ref: "<automation key>", x, y, w, h }
 *
 * `PUT /api/layout` is a whole-dashboard atomic replace, so this reads the current
 * layout and merges rather than sending only the showcase (Req §12.1). Three groups
 * come out of that read:
 *
 *   declared showcase tabs  — replaced from source; the showcase owns their contents
 *   retired showcase tabs   — in the ledger but no longer declared, so dropped
 *   everything else         — yours, passed through untouched
 *
 * Retirement is the reason tab ownership is in the ledger at all: without it, a tab
 * removed from demo/seed/tabs/ would be indistinguishable from one you created and
 * would survive every future reseed.
 *
 * Showcase tabs take orders 0..n-1 from module order, and your tabs follow in their
 * existing relative order. The seeder owns the ordering of its own tabs, which keeps a
 * rerun deterministic (Req §12.1). Tab order stays in code deliberately: the module
 * registry reasons about why Agriculture leads and Space is last, and a stray drag on the
 * Pi should not silently rewrite that. Pane GEOMETRY is the opposite — it is meant to be
 * tuned by eye — so it comes from the captured layout (§7.2).
 *
 * @param {{tab: {id, name, icon}, automations: object[]}[]} tabModules
 * @param {Record<string, string>} idMap - automation key → ruleId
 * @param {{tabs: Record<string, object[]>}} [layout] Captured pane geometry. Defaults to
 *   the committed fixture; injectable so a test can supply its own.
 */
export async function buildLayout(api, tabModules, idMap, layout = parseShowcaseLayout()) {
  const now = new Date().toISOString();
  const declaredTabIds = tabModules.map((mod) => mod.tab.id);
  const ledger = await readShowcaseLedger(api);
  const showcaseOwned = new Set([...declaredTabIds, ...ledger.tabIds]);

  const current = await api("GET", "/api/layout");
  const currentTabs = Array.isArray(current?.tabs) ? current.tabs : [];
  const currentPanes = Array.isArray(current?.panes) ? current.panes : [];

  const keptTabs = currentTabs
    .filter((tab) => tab && typeof tab.id === "string" && !showcaseOwned.has(tab.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const keptTabIds = new Set(keptTabs.map((tab) => tab.id));

  // Panes are carried over verbatim, config included. That matters beyond geometry:
  // the PUT rebuilds automation→tab ownership from each pane's `config.ruleId`, so
  // dropping a pane here would silently unscope the automation behind it.
  const keptPanes = currentPanes.filter((pane) => pane && keptTabIds.has(pane.tabId));

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

    // A declared tab with no captured geometry would seed as an empty tab and report
    // success, which is the failure this refuses to perform quietly.
    const declaredPanes = layout.tabs[mod.tab.id];
    if (!Array.isArray(declaredPanes)) {
      throw new Error(
        `No captured layout for tab "${mod.tab.id}". Add it to demo/seed/layouts/showcase-layout.json, `
        + `or arrange the tab and run: make showcase-capture-layout PASS=<password>`,
      );
    }

    declaredPanes.forEach((p, paneIndex) => {
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
        // A ref the tab does not declare would seed a pane pointing at an empty ruleId,
        // which renders as a broken pane and unscopes nothing — so it is silent. This is
        // the check that keeps a captured layout honest against a renamed automation.
        if (!automation) {
          throw new Error(
            `Captured layout for "${mod.tab.id}" references automation "${p.ref}", which that tab `
            + `does not declare. Rename it in demo/seed/layouts/showcase-layout.json, or re-capture.`,
          );
        }
        panes.push({
          ...base,
          paneType: "automation",
          config: { ruleId: idMap[p.ref] || "", ruleName: automation.name || "" },
        });
      }
    });
  });

  keptTabs.forEach((tab, index) => {
    tabs.push({ ...tab, order: tabModules.length + index });
  });
  panes.push(...keptPanes);

  await api("PUT", "/api/layout", { tabs, panes });
  await recordShowcaseTabs(api, declaredTabIds, ledger.tabIds);

  const retired = ledger.tabIds.filter((id) => !declaredTabIds.includes(id));
  console.log(
    `  ✓ Layout: ${declaredTabIds.length} showcase tabs, ${panes.length - keptPanes.length} panes`,
  );
  if (keptTabs.length > 0) {
    console.log(`  ✓ Preserved ${keptTabs.length} tab(s) you authored, with ${keptPanes.length} pane(s)`);
  }
  if (retired.length > 0) {
    console.log(`  ✓ Retired ${retired.length} tab(s) the showcase no longer declares: ${retired.join(", ")}`);
  }
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
