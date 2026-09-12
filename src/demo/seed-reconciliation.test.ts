// showcase-cleanup §12.1 — a reseed must not delete resources the operator authored.
//
// The collection half of §12.1 is covered in seed-idempotency.test.ts. This file covers
// the two harder halves: automations, which have server-generated ids and no ownership
// column, and the dashboard layout, which `PUT /api/layout` replaces wholesale.
//
// What the old seeder did, and what is being prevented:
//
//   cleanSlate()  → DELETE every automation on the install
//                 → PUT /api/layout { tabs: [], panes: [] }
//
// So an operator who installed Aeolus, authored an automation and a tab, then tried the
// showcase, lost both. The standing advice — "wipe the database and seed again" — hid
// that rather than fixing it.
//
// Ownership is now tracked in a Data Store bucket keyed by the stable module key
// (§12.2). Removal is by recorded id, which is exact. The one exception is a single
// adoption pass for installs seeded before the ledger existed, where nothing but the
// display name is available to go on.

import { describe, it, expect } from "vitest";
import {
  SHOWCASE_LEDGER_BUCKET,
  readShowcaseLedger,
  recordShowcaseAutomation,
  recordShowcaseTabs,
  reconcileShowcaseAutomations,
  createAutomations,
  buildLayout,
} from "../../demo/seed/lib.mjs";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  tolerate?: number[];
}

interface Rule {
  id: string;
  name: string;
}

interface Tab {
  id: string;
  name: string;
  icon?: string;
  order?: number;
  pinned?: boolean;
  createdAt?: unknown;
}

interface Pane {
  id: string;
  tabId: string;
  paneType?: string;
  config?: Record<string, unknown>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

const LEDGER_PATH = `/api/data-store/buckets/${encodeURIComponent(SHOWCASE_LEDGER_BUCKET)}`;

/**
 * A fake Aeolus that holds real state: automations, one bucket per name, and a layout.
 *
 * Stateful rather than assertion-only because the behaviour under test is "what is left
 * behind afterwards". A call-log-only fake would let a seeder that deletes everything
 * and recreates it pass.
 */
function fakeAeolus(
  initial: { automations?: Rule[]; buckets?: Record<string, Record<string, unknown>>; tabs?: Tab[]; panes?: Pane[] } = {},
) {
  const calls: Call[] = [];
  const automations: Rule[] = [...(initial.automations ?? [])];
  const buckets: Record<string, Record<string, unknown>> = structuredClone(initial.buckets ?? {});
  let tabs: Tab[] = structuredClone(initial.tabs ?? []);
  let panes: Pane[] = structuredClone(initial.panes ?? []);
  let nextId = 1;

  const api = async (
    method: string,
    reqPath: string,
    body?: unknown,
    opts?: { tolerate?: number[] },
  ): Promise<unknown> => {
    calls.push({ method, path: reqPath, body, ...(opts?.tolerate ? { tolerate: opts.tolerate } : {}) });
    const tolerate = opts?.tolerate ?? [];

    const bucketEntry = /^\/api\/data-store\/buckets\/([^/]+)\/([^/]+)$/.exec(reqPath);
    const bucketList = /^\/api\/data-store\/buckets\/([^/]+)$/.exec(reqPath);
    const automation = /^\/api\/automations\/(.+)$/.exec(reqPath);

    if (method === "GET" && bucketList) {
      const name = decodeURIComponent(bucketList[1]!);
      return Object.entries(buckets[name] ?? {}).map(([key, value]) => ({ key, value, updatedAt: 0 }));
    }
    if (method === "PUT" && bucketEntry) {
      const name = decodeURIComponent(bucketEntry[1]!);
      const key = decodeURIComponent(bucketEntry[2]!);
      buckets[name] ??= {};
      buckets[name][key] = (body as { value: unknown }).value;
      return { success: true };
    }
    if (method === "DELETE" && bucketEntry) {
      const name = decodeURIComponent(bucketEntry[1]!);
      const key = decodeURIComponent(bucketEntry[2]!);
      if (!buckets[name] || !(key in buckets[name])) return reject(404, tolerate, method, reqPath);
      delete buckets[name][key];
      return { success: true };
    }
    if (method === "GET" && reqPath === "/api/automations") {
      return automations.map((rule) => ({ ...rule }));
    }
    if (method === "POST" && reqPath === "/api/automations") {
      const created = { id: `rule-${nextId++}`, name: (body as { name: string }).name };
      automations.push(created);
      return created;
    }
    if (method === "DELETE" && automation) {
      const id = automation[1]!;
      const index = automations.findIndex((rule) => rule.id === id);
      if (index === -1) return reject(404, tolerate, method, reqPath);
      automations.splice(index, 1);
      return { success: true };
    }
    if (method === "GET" && reqPath === "/api/layout") {
      return { tabs: structuredClone(tabs), panes: structuredClone(panes) };
    }
    if (method === "PUT" && reqPath === "/api/layout") {
      const next = body as { tabs: Tab[]; panes: Pane[] };
      tabs = structuredClone(next.tabs);
      panes = structuredClone(next.panes);
      return { success: true };
    }
    return { success: true };
  };

  function reject(status: number, tolerate: number[], method: string, reqPath: string): null {
    if (tolerate.includes(status)) return null;
    throw new Error(`${method} ${reqPath} → ${status}`);
  }

  return {
    api,
    calls,
    get automations() { return automations; },
    get buckets() { return buckets; },
    get tabs() { return tabs; },
    get panes() { return panes; },
  };
}

const SHOWCASE = [
  { key: "farm-water", name: "Water Management" },
  { key: "farm-livestock", name: "Livestock & Virtual Fence" },
];

describe("showcase ledger", () => {
  it("reports an install that has never been seeded as having no ledger", async () => {
    // Which is what arms the one-time adoption pass. An empty bucket and a missing
    // bucket are the same answer here, deliberately: both mean "nothing recorded".
    const box = fakeAeolus();
    const ledger = await readShowcaseLedger(box.api);

    expect(ledger.existed).toBe(false);
    expect(ledger.automations.size).toBe(0);
    expect(ledger.tabIds).toEqual([]);
  });

  it("round-trips automation keys and tab ids through the bucket", async () => {
    const box = fakeAeolus();
    await recordShowcaseAutomation(box.api, "farm-water", "rule-9");
    await recordShowcaseTabs(box.api, ["tab-agriculture"]);

    const ledger = await readShowcaseLedger(box.api);
    expect(ledger.existed).toBe(true);
    expect(ledger.automations.get("farm-water")).toBe("rule-9");
    expect(ledger.tabIds).toEqual(["tab-agriculture"]);
  });

  it("ignores a corrupted entry rather than sending a junk id to a DELETE", async () => {
    const box = fakeAeolus({
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": { not: "a rule id" }, "automation:ok": "rule-2" } },
    });

    const ledger = await readShowcaseLedger(box.api);
    expect(ledger.automations.has("farm-water")).toBe(false);
    expect(ledger.automations.get("ok")).toBe("rule-2");
  });

  it("releases a tab the showcase no longer declares", async () => {
    // Without this a retired tab looks like one the operator authored and survives
    // every future reseed.
    const box = fakeAeolus({
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "tab:tab-agriculture": true, "tab:tab-retired": true } },
    });

    await recordShowcaseTabs(box.api, ["tab-agriculture"], ["tab-agriculture", "tab-retired"]);

    const ledger = await readShowcaseLedger(box.api);
    expect(ledger.tabIds).toEqual(["tab-agriculture"]);
  });
});

describe("createAutomations — records ownership as it goes", () => {
  // Real project directories, so this exercises the actual loader rather than a shape
  // that only resembles a seed descriptor.
  const declared = [
    { key: "farm-water", name: "Water Management", projectDir: "farm-water" },
    { key: "farm-livestock", name: "Livestock & Virtual Fence", projectDir: "farm-livestock" },
  ];

  it("maps every stable module key to the rule id the server generated", async () => {
    const box = fakeAeolus();
    const idMap = await createAutomations(box.api, declared as never);

    expect(idMap).toEqual({ "farm-water": "rule-1", "farm-livestock": "rule-2" });
    const ledger = await readShowcaseLedger(box.api);
    expect(Object.fromEntries(ledger.automations)).toEqual(idMap);
  });

  it("writes each ledger entry before creating the next automation", async () => {
    // Per-automation, not one bulk write at the end. A seed that dies partway through
    // must still leave the ledger naming every rule that exists, or the next run
    // orphans them and adds a second copy.
    const box = fakeAeolus();
    await createAutomations(box.api, declared as never);

    const relevant = box.calls
      .filter((c) => c.path === "/api/automations" || c.path.startsWith(LEDGER_PATH))
      .map((c) => `${c.method} ${c.path}`);

    expect(relevant).toEqual([
      "POST /api/automations",
      `PUT ${LEDGER_PATH}/${encodeURIComponent("automation:farm-water")}`,
      "POST /api/automations",
      `PUT ${LEDGER_PATH}/${encodeURIComponent("automation:farm-livestock")}`,
    ]);
  });

  it("leaves a truthful ledger when creation aborts partway through", async () => {
    const box = fakeAeolus();
    const api = async (method: string, reqPath: string, body?: unknown, opts?: { tolerate?: number[] }) => {
      if (method === "POST" && reqPath === "/api/automations" && (body as { name: string }).name.startsWith("Livestock")) {
        throw new Error("backend died");
      }
      return box.api(method, reqPath, body, opts);
    };

    await expect(createAutomations(api, declared as never)).rejects.toThrow("backend died");

    // One rule exists, and the ledger names exactly that one — so the next run
    // reclaims it rather than leaving it behind beside a fresh copy.
    expect(box.automations.map((r) => r.id)).toEqual(["rule-1"]);
    const ledger = await readShowcaseLedger(box.api);
    expect(Object.fromEntries(ledger.automations)).toEqual({ "farm-water": "rule-1" });
  });

  it("round-trips a recorded entry under its stable module key", async () => {
    const box = fakeAeolus();
    await recordShowcaseAutomation(box.api, "farm-water", "rule-1");

    expect(box.buckets[SHOWCASE_LEDGER_BUCKET]).toEqual({ "automation:farm-water": "rule-1" });
  });
});

describe("reconcileShowcaseAutomations", () => {
  it("removes only the rules the ledger names", async () => {
    const box = fakeAeolus({
      automations: [
        { id: "rule-1", name: "Water Management" },
        { id: "rule-2", name: "My Shed Lights" },
      ],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": "rule-1", "tab:tab-agriculture": true } },
    });

    const result = await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.automations.map((r) => r.id)).toEqual(["rule-2"]);
    expect(result).toMatchObject({ reclaimed: 1, adopted: 0, preserved: 1 });
  });

  it("leaves an operator automation that shares a name once the ledger exists", async () => {
    // The residual risk of name matching, closed. "Water Management" is a showcase
    // name, but the ledger says this install's copy is rule-1, so rule-7 is not ours.
    const box = fakeAeolus({
      automations: [
        { id: "rule-1", name: "Water Management" },
        { id: "rule-7", name: "Water Management" },
      ],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": "rule-1" } },
    });

    await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.automations.map((r) => r.id)).toEqual(["rule-7"]);
  });

  it("adopts pre-ledger showcase automations by declared name, exactly once", async () => {
    // The upgrade path. An install seeded by an older revision has showcase
    // automations and no record of them; without adoption they would be orphaned and
    // duplicated on the first ledger-aware reseed.
    const box = fakeAeolus({
      automations: [
        { id: "old-1", name: "Water Management" },
        { id: "old-2", name: "Livestock & Virtual Fence" },
        { id: "mine", name: "My Shed Lights" },
      ],
    });

    const result = await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.automations.map((r) => r.id)).toEqual(["mine"]);
    expect(result).toMatchObject({ reclaimed: 2, adopted: 2, preserved: 1 });
  });

  it("never matches by name once a ledger exists, even for a declared name", async () => {
    const box = fakeAeolus({
      automations: [{ id: "stray", name: "Water Management" }],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "tab:tab-agriculture": true } },
    });

    const result = await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.automations.map((r) => r.id)).toEqual(["stray"]);
    expect(result).toMatchObject({ reclaimed: 0, adopted: 0 });
  });

  it("survives a ledger entry whose rule was deleted by hand", async () => {
    // A stale entry is not an error and does not produce a doomed request: the rule is
    // absent from the live set, so nothing is issued for it. The entry is still cleared,
    // so the ledger stops naming something that does not exist.
    const box = fakeAeolus({
      automations: [{ id: "rule-2", name: "My Shed Lights" }],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": "rule-1" } },
    });

    await expect(reconcileShowcaseAutomations(box.api, SHOWCASE)).resolves.toMatchObject({ reclaimed: 0 });
    expect(box.automations.map((r) => r.id)).toEqual(["rule-2"]);
    expect(box.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/api/automations/"))).toHaveLength(0);
    expect(box.buckets[SHOWCASE_LEDGER_BUCKET]).toEqual({});
  });

  it("tolerates a 404 on the delete it does issue, in case of a concurrent removal", async () => {
    const box = fakeAeolus({
      automations: [{ id: "rule-1", name: "Water Management" }],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": "rule-1" } },
    });

    await reconcileShowcaseAutomations(box.api, SHOWCASE);

    const del = box.calls.find((c) => c.method === "DELETE" && c.path === "/api/automations/rule-1");
    expect(del?.tolerate).toContain(404);
  });

  it("clears its automation entries but keeps the tab entries for the layout merge", async () => {
    // Tab ownership is still needed at layout time to spot retired tabs, so the
    // reconcile must not clear the whole bucket.
    const box = fakeAeolus({
      automations: [{ id: "rule-1", name: "Water Management" }],
      buckets: {
        [SHOWCASE_LEDGER_BUCKET]: { "automation:farm-water": "rule-1", "tab:tab-agriculture": true },
      },
    });

    await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.buckets[SHOWCASE_LEDGER_BUCKET]).toEqual({ "tab:tab-agriculture": true });
  });

  it("never deletes every automation the way the old clean slate did", async () => {
    const box = fakeAeolus({
      automations: [
        { id: "mine-1", name: "My Shed Lights" },
        { id: "mine-2", name: "Gate Opener" },
      ],
      buckets: { [SHOWCASE_LEDGER_BUCKET]: { "tab:tab-agriculture": true } },
    });

    await reconcileShowcaseAutomations(box.api, SHOWCASE);

    expect(box.automations).toHaveLength(2);
    const deletes = box.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/api/automations/"));
    expect(deletes).toHaveLength(0);
  });
});

describe("buildLayout — merges instead of replacing the dashboard", () => {
  const tabModules = [
    {
      tab: { id: "tab-agriculture", name: "Agriculture", icon: "sprout" },
      automations: [{ key: "farm-water", name: "Water Management" }],
      panes: [{ kind: "automation", ref: "farm-water", x: 0, y: 0, w: 6, h: 13 }],
    },
  ];
  const idMap = { "farm-water": "rule-1" };

  it("keeps a tab the operator authored, and its panes", async () => {
    const box = fakeAeolus({
      tabs: [{ id: "tab-mine", name: "My Shed", icon: "home", order: 0, pinned: false, createdAt: 1 }],
      panes: [{ id: "pane-mine", tabId: "tab-mine", paneType: "automation", config: { ruleId: "mine-1" }, x: 0, y: 0, w: 6, h: 4 }],
    });

    await buildLayout(box.api, tabModules as never, idMap);

    expect(box.tabs.map((t) => t.id)).toContain("tab-mine");
    expect(box.panes.map((p) => p.id)).toContain("pane-mine");
  });

  it("carries an operator pane's config through untouched", async () => {
    // Not cosmetic: PUT /api/layout rebuilds automation→tab ownership from each pane's
    // config.ruleId, so dropping the config would silently unscope their automation.
    const box = fakeAeolus({
      tabs: [{ id: "tab-mine", name: "My Shed", icon: "home", order: 0, createdAt: 1 }],
      panes: [{ id: "pane-mine", tabId: "tab-mine", paneType: "automation", config: { ruleId: "mine-1", ruleName: "My Shed Lights" }, x: 1, y: 2, w: 3, h: 4 }],
    });

    await buildLayout(box.api, tabModules as never, idMap);

    const kept = box.panes.find((p) => p.id === "pane-mine");
    expect(kept?.config).toEqual({ ruleId: "mine-1", ruleName: "My Shed Lights" });
    expect(kept).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("replaces the showcase tab's own panes rather than accumulating them", async () => {
    const box = fakeAeolus({
      tabs: [{ id: "tab-agriculture", name: "Agriculture", icon: "sprout", order: 0, createdAt: 1 }],
      panes: [{ id: "tab-agriculture-pane-0", tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "stale" }, x: 0, y: 0, w: 6, h: 13 }],
    });

    await buildLayout(box.api, tabModules as never, idMap);

    const showcasePanes = box.panes.filter((p) => p.tabId === "tab-agriculture");
    expect(showcasePanes).toHaveLength(1);
    expect(showcasePanes[0]!.config).toEqual({ ruleId: "rule-1", ruleName: "Water Management" });
  });

  it("drops a tab the showcase used to declare but no longer does", async () => {
    const box = fakeAeolus({
      tabs: [
        { id: "tab-agriculture", name: "Agriculture", icon: "sprout", order: 0, createdAt: 1 },
        { id: "tab-retired", name: "Retired Showcase", icon: "x", order: 1, createdAt: 1 },
        { id: "tab-mine", name: "My Shed", icon: "home", order: 2, createdAt: 1 },
      ],
      panes: [{ id: "tab-retired-pane-0", tabId: "tab-retired", paneType: "automation", config: {}, x: 0, y: 0, w: 6, h: 4 }],
      buckets: {
        [SHOWCASE_LEDGER_BUCKET]: { "tab:tab-agriculture": true, "tab:tab-retired": true },
      },
    });

    await buildLayout(box.api, tabModules as never, idMap);

    expect(box.tabs.map((t) => t.id)).toEqual(["tab-agriculture", "tab-mine"]);
    expect(box.panes.some((p) => p.tabId === "tab-retired")).toBe(false);
  });

  it("puts showcase tabs first and keeps operator tabs in their relative order", async () => {
    const box = fakeAeolus({
      tabs: [
        { id: "tab-second", name: "Second", icon: "b", order: 5, createdAt: 1 },
        { id: "tab-first", name: "First", icon: "a", order: 2, createdAt: 1 },
      ],
    });

    await buildLayout(box.api, tabModules as never, idMap);

    expect(box.tabs.map((t) => t.id)).toEqual(["tab-agriculture", "tab-first", "tab-second"]);
    expect(box.tabs.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it("records the tabs it declared, so the next run can spot retirement", async () => {
    const box = fakeAeolus();

    await buildLayout(box.api, tabModules as never, idMap);

    const ledger = await readShowcaseLedger(box.api);
    expect(ledger.tabIds).toEqual(["tab-agriculture"]);
  });

  it("never sends an empty layout the way the old clean slate did", async () => {
    const box = fakeAeolus({
      tabs: [{ id: "tab-mine", name: "My Shed", icon: "home", order: 0, createdAt: 1 }],
    });

    await buildLayout(box.api, tabModules as never, idMap);

    const puts = box.calls.filter((c) => c.method === "PUT" && c.path === "/api/layout");
    expect(puts).toHaveLength(1);
    expect((puts[0]!.body as { tabs: Tab[] }).tabs.length).toBeGreaterThan(0);
  });

  it("reads the current layout before replacing it", async () => {
    const box = fakeAeolus();
    await buildLayout(box.api, tabModules as never, idMap);

    const order = box.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf("GET /api/layout")).toBeLessThan(order.indexOf("PUT /api/layout"));
  });
});

describe("seeder wiring", () => {
  it("no longer exports the clean slate that deleted everything", async () => {
    const lib = (await import("../../demo/seed/lib.mjs")) as Record<string, unknown>;
    expect(lib.cleanSlate).toBeUndefined();
    expect(typeof lib.reconcileShowcaseAutomations).toBe("function");
  });

  it("keeps the ledger bucket out of the declared showcase buckets", async () => {
    // seedBucket clears every key in a bucket it declares. If the ledger were declared,
    // seeding would erase the record of what it owns on the way past.
    const { demoBuckets } = (await import("../../demo/seed/data-store-buckets.mjs")) as {
      demoBuckets: { name: string }[];
    };
    expect(demoBuckets.map((b) => b.name)).not.toContain(SHOWCASE_LEDGER_BUCKET);
  });
});
