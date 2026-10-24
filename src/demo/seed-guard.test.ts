// The real-install guard: the seeder refuses to mix the showcase into an install that
// has never been seeded and already holds content of its own.
//
// Seeding cannot be undone (there is no command that removes the showcase again, and
// `make showcase` adds a simulator publishing retained fake devices), so the cases
// that matter are the ones that must STILL be allowed: a pristine install, a showcase
// install reseeding, and a pre-ledger showcase install reaching the adoption pass.

import { describe, it, expect } from "vitest";
import {
  SHOWCASE_LEDGER_BUCKET,
  findForeignContent,
  inspectSeedTarget,
} from "../../demo/seed/lib.mjs";

const DECLARED = {
  declaredNames: ["Water Management", "Livestock & Virtual Fence"],
  declaredTabIds: ["tab-agriculture", "tab-wildlife"],
};

const PINNED = [
  { id: "default-dashboard", name: "System", pinned: true },
  { id: "default-security", name: "Security", pinned: true },
];

describe("findForeignContent", () => {
  it("reports nothing on a pristine install", () => {
    expect(findForeignContent({ ledgerExisted: false, automations: [], tabs: PINNED, ...DECLARED }))
      .toEqual({ automations: [], tabs: [] });
  });

  it("reports automations and custom tabs the showcase does not declare", () => {
    const result = findForeignContent({
      ledgerExisted: false,
      automations: [{ id: "r1", name: "Garden pump" }, { id: "r2", name: "Water Management" }],
      tabs: [...PINNED, { id: "tab-garden", name: "Garden" }, { id: "tab-agriculture", name: "Agriculture" }],
      ...DECLARED,
    });
    expect(result).toEqual({ automations: ["Garden pump"], tabs: ["Garden"] });
  });

  it("lets a pre-ledger showcase install through to the adoption pass", () => {
    // Only showcase-named automations and showcase tab ids: the install an older
    // seeder left behind without a ledger.
    const result = findForeignContent({
      ledgerExisted: false,
      automations: [{ id: "r1", name: "Water Management" }, { id: "r2", name: "Livestock & Virtual Fence" }],
      tabs: [...PINNED, { id: "tab-agriculture", name: "Agriculture" }],
      ...DECLARED,
    });
    expect(result).toEqual({ automations: [], tabs: [] });
  });

  it("reports nothing once a ledger exists, whatever else is on the install", () => {
    const result = findForeignContent({
      ledgerExisted: true,
      automations: [{ id: "r1", name: "Garden pump" }],
      tabs: [{ id: "tab-garden", name: "Garden" }],
      ...DECLARED,
    });
    expect(result).toEqual({ automations: [], tabs: [] });
  });

  it("falls back to the id when an entry has no name", () => {
    const result = findForeignContent({
      ledgerExisted: false,
      automations: [{ id: "rule-7" }],
      tabs: [{ id: "tab-unnamed" }],
      ...DECLARED,
    });
    expect(result).toEqual({ automations: ["rule-7"], tabs: ["tab-unnamed"] });
  });
});

describe("inspectSeedTarget", () => {
  const LEDGER_PATH = `/api/shared-state/${encodeURIComponent(SHOWCASE_LEDGER_BUCKET)}`;

  function fakeApi(state: {
    ledger?: { key: string; value: unknown }[] | null;
    automations?: unknown;
    layout?: unknown;
  }) {
    const calls: string[] = [];
    const api = async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (method !== "GET") throw new Error(`inspectSeedTarget must be read-only, got ${method} ${path}`);
      if (path === LEDGER_PATH) return state.ledger ?? null; // null = a tolerated 404
      if (path === "/api/automations") return state.automations;
      if (path === "/api/layout") return state.layout;
      throw new Error(`unexpected ${path}`);
    };
    return { api, calls };
  }

  it("finds a real install's own content without writing anything", async () => {
    const { api, calls } = fakeApi({
      automations: [{ id: "r1", name: "Garden pump" }],
      layout: { revision: 3, tabs: [...PINNED, { id: "tab-garden", name: "Garden" }], panes: [] },
    });

    expect(await inspectSeedTarget(api, DECLARED)).toEqual({ automations: ["Garden pump"], tabs: ["Garden"] });
    expect(calls).toEqual([`GET ${LEDGER_PATH}`, "GET /api/automations", "GET /api/layout"]);
  });

  it("stops at the ledger when the showcase already lives here", async () => {
    const { api, calls } = fakeApi({
      ledger: [{ key: "automation:farm-water", value: "rule-1" }],
      automations: [{ id: "r9", name: "Garden pump" }],
    });

    expect(await inspectSeedTarget(api, DECLARED)).toEqual({ automations: [], tabs: [] });
    expect(calls).toEqual([`GET ${LEDGER_PATH}`]);
  });

  it("treats malformed list responses as empty rather than throwing", async () => {
    const { api } = fakeApi({ automations: { error: "nope" }, layout: {} });
    expect(await inspectSeedTarget(api, DECLARED)).toEqual({ automations: [], tabs: [] });
  });
});
