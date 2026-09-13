// showcase-cleanup §7.2 — the layout capture workflow.
//
// Pane geometry used to live inline in each tab module, which made the seeder the author
// of the arrangement: `buildLayout` rewrote every showcase tab from those numbers, so a
// layout tuned by hand on the Pi was destroyed by the next seed. One canonical file keyed
// by stable ids inverts that — a human arranges, the capture tool records, the seeder
// reproduces.
//
// The requirement with no forgiving failure mode is §7.2's fifth point: never copy
// arbitrary user-created tabs or panes into the showcase fixture. That is not a tidiness
// concern. The seeder RETIRES showcase-owned tabs it no longer declares, so a captured
// personal tab would be deleted on a later reseed — a capture bug would destroy someone's
// work two commands after it ran, with nothing connecting the two events.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCapturedLayout } from "../../demo/seed/layouts/derive.mjs";
import {
  GRID_COLUMNS,
  LAYOUT_PATH,
  formatShowcaseLayout,
  parseShowcaseLayout,
} from "../../demo/seed/layouts/index.mjs";
import { tabModules } from "../../demo/seed/tabs/index.mjs";

/** A minimal showcase: one tab, two automations the ledger owns. */
function showcase() {
  return {
    tabModules: [
      {
        tab: { id: "tab-agriculture", name: "Agriculture", icon: "sprout" },
        automations: [{ key: "farm-water" }, { key: "farm-livestock" }],
      },
    ],
    ledger: {
      automations: new Map([
        ["farm-water", "rule-water"],
        ["farm-livestock", "rule-livestock"],
      ]),
    },
    liveTabs: [{ id: "tab-agriculture" }],
    livePanes: [
      { tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-water" }, x: 0, y: 0, w: 6, h: 13 },
      { tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-livestock" }, x: 6, y: 0, w: 6, h: 13 },
    ],
  };
}

describe("showcase layout capture", () => {
  it("records the geometry a human arranged, keyed by automation rather than rule id", () => {
    const { tabs, skipped } = deriveCapturedLayout(showcase());

    expect(skipped).toEqual([]);
    expect(tabs["tab-agriculture"]).toEqual([
      { kind: "automation", ref: "farm-water", x: 0, y: 0, w: 6, h: 13 },
      { kind: "automation", ref: "farm-livestock", x: 6, y: 0, w: 6, h: 13 },
    ]);
  });

  it("never captures a tab the operator authored", () => {
    // The tab is on the dashboard, has panes, and is not declared by any module. It must
    // not appear in the fixture at all — if it did, the next reseed would retire it.
    const input = showcase();
    input.liveTabs.push({ id: "tab-my-shed" });
    input.livePanes.push({
      tabId: "tab-my-shed", paneType: "automation", config: { ruleId: "rule-mine" },
      x: 0, y: 0, w: 12, h: 8,
    });

    const { tabs } = deriveCapturedLayout(input);

    expect(Object.keys(tabs)).toEqual(["tab-agriculture"]);
    expect(JSON.stringify(tabs)).not.toContain("tab-my-shed");
  });

  it("never captures an operator's pane sitting on a showcase tab", () => {
    // Harder than the last one: the tab IS the showcase's, so the tab filter does not
    // help. Only the ledger can say the automation behind this pane is not.
    const input = showcase();
    input.livePanes.push({
      tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-someone-elses" },
      x: 0, y: 13, w: 6, h: 6,
    });

    const { tabs, skipped } = deriveCapturedLayout(input);

    expect(tabs["tab-agriculture"]).toHaveLength(2);
    expect(JSON.stringify(tabs)).not.toContain("rule-someone-elses");
    expect(skipped.join(" ")).toMatch(/does not own/);
  });

  it("does not mistake a personal automation for a showcase one by name or shape", () => {
    // A pane whose config carries a plausible ruleName but a rule id the ledger has never
    // heard of. Matching on anything but the ledger would capture it.
    const input = showcase();
    input.livePanes.push({
      tabId: "tab-agriculture", paneType: "automation",
      config: { ruleId: "rule-impostor", ruleName: "Water Management" },
      x: 0, y: 26, w: 6, h: 6,
    });

    const { tabs } = deriveCapturedLayout(input);

    expect(tabs["tab-agriculture"].map((p) => p.ref)).toEqual(["farm-water", "farm-livestock"]);
  });

  it("skips a pane type the showcase does not use", () => {
    const input = showcase();
    input.livePanes.push({ tabId: "tab-agriculture", paneType: "hue-control", config: {}, x: 0, y: 13, w: 3, h: 3 });

    const { tabs, skipped } = deriveCapturedLayout(input);

    expect(tabs["tab-agriculture"]).toHaveLength(2);
    expect(skipped.join(" ")).toMatch(/not a showcase pane type/);
  });

  it("refuses to refile a showcase pane that was dragged to another showcase tab", () => {
    // Composition is the tab modules' business; this tool only records geometry. Writing
    // the move would produce a fixture the seeder rejects, so it is reported instead.
    const input = showcase();
    input.tabModules.push({ tab: { id: "tab-wildlife" }, automations: [{ key: "wildlife-detection" }] });
    input.ledger.automations.set("wildlife-detection", "rule-detection");
    input.liveTabs.push({ id: "tab-wildlife" });
    input.livePanes.push({
      tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-detection" },
      x: 0, y: 13, w: 12, h: 6,
    });

    const { tabs, skipped } = deriveCapturedLayout(input);

    expect(tabs["tab-agriculture"].map((p) => p.ref)).toEqual(["farm-water", "farm-livestock"]);
    expect(skipped.join(" ")).toMatch(/declared on tab-wildlife/);
  });

  it("says so when a pane that was in the fixture has vanished", () => {
    // Capturing silently would delete it from the showcase on the next seed, and the
    // operator would have no idea which of their drags did it.
    const input = showcase();
    input.livePanes = input.livePanes.filter((p) => p.config.ruleId !== "rule-livestock");

    const { tabs, skipped } = deriveCapturedLayout({
      ...input,
      previous: {
        "tab-agriculture": [
          { kind: "automation", ref: "farm-water", x: 0, y: 0, w: 6, h: 13 },
          { kind: "automation", ref: "farm-livestock", x: 6, y: 0, w: 6, h: 13 },
        ],
      },
    });

    expect(tabs["tab-agriculture"]).toHaveLength(1);
    expect(skipped.join(" ")).toMatch(/farm-livestock.*has no pane/);
  });

  it("reports a declared tab that is missing from the dashboard", () => {
    const input = showcase();
    input.liveTabs = [];

    const { tabs, skipped } = deriveCapturedLayout(input);

    expect(tabs).toEqual({});
    expect(skipped.join(" ")).toMatch(/not on this dashboard/);
  });

  it("orders panes the way the tab reads, so a nudge makes a small diff", () => {
    const input = showcase();
    // Delivered by the API bottom-right first.
    input.livePanes = [
      { tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-livestock" }, x: 6, y: 13, w: 6, h: 6 },
      { tabId: "tab-agriculture", paneType: "automation", config: { ruleId: "rule-water" }, x: 0, y: 0, w: 6, h: 13 },
    ];

    const { tabs } = deriveCapturedLayout(input);

    expect(tabs["tab-agriculture"].map((p) => p.ref)).toEqual(["farm-water", "farm-livestock"]);
  });
});

describe("showcase layout fixture", () => {
  it("is valid, and covers every declared tab", () => {
    // The seeder throws on a tab with no captured geometry rather than seeding it empty,
    // so this failing means seeding is broken.
    const layout = parseShowcaseLayout();
    for (const mod of tabModules) {
      expect(layout.tabs[mod.tab.id], `no captured layout for ${mod.tab.id}`).toBeDefined();
    }
  });

  it("references only automations the owning tab declares", () => {
    const layout = parseShowcaseLayout();
    for (const mod of tabModules) {
      const declared = new Set((mod.automations || []).map((a: { key: string }) => a.key));
      for (const pane of layout.tabs[mod.tab.id] || []) {
        if (!pane.ref) continue;
        expect(declared, `${mod.tab.id} pane "${pane.ref}" is not declared by that tab`).toContain(pane.ref);
      }
    }
  });

  it("keeps every pane inside the grid", () => {
    const layout = parseShowcaseLayout();
    for (const [tabId, panes] of Object.entries(layout.tabs)) {
      for (const pane of panes) {
        expect(pane.x + pane.w, `${tabId} pane runs past the grid`).toBeLessThanOrEqual(GRID_COLUMNS);
      }
    }
  });

  it("round-trips through the formatter unchanged", () => {
    // The capture tool compares its output to the file byte-for-byte to decide whether
    // anything moved. If the formatter did not reproduce the committed file exactly, every
    // capture would report a change and every run would produce a diff.
    const committed = readFileSync(LAYOUT_PATH, "utf8");
    const doc = JSON.parse(committed);
    expect(formatShowcaseLayout(doc)).toBe(committed);
  });

  it("rejects a document that would seed a pane on top of another", () => {
    // Validation is the reason this file can be generated and still trusted: an absent
    // coordinate would reach PUT /api/layout as undefined and land at the origin.
    expect(() => parseShowcaseLayout('{"tabs":{"t":[{"ref":"a","x":0,"y":0,"w":6}]}}'))
      .toThrow(/\.h must be a non-negative integer/);
    expect(() => parseShowcaseLayout('{"tabs":{"t":[{"ref":"a","x":0,"y":0,"w":6,"h":0}]}}'))
      .toThrow(/no area/);
    expect(() => parseShowcaseLayout('{"tabs":{"t":[{"ref":"a","x":8,"y":0,"w":6,"h":4}]}}'))
      .toThrow(/past the 12-column grid/);
    expect(() => parseShowcaseLayout('{"tabs":{"t":[{"x":0,"y":0,"w":6,"h":4}]}}'))
      .toThrow(/needs a "ref"/);
    expect(() => parseShowcaseLayout('{"tabs":{"t":[{"ref":"a","x":0,"y":0,"w":6,"h":4},{"ref":"a","x":0,"y":4,"w":6,"h":4}]}}'))
      .toThrow(/repeats ref/);
  });
});
