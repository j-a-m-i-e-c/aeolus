// demo/seed/layouts/derive.mjs — work out the captured layout from a live dashboard.
//
// Split from the capture script so it can be tested without a backend. The one rule that
// matters here has no forgiving failure mode: a tab or pane an operator authored must
// never be swept into the showcase fixture. If it were, the next reseed would "retire"
// it — the seeder deletes showcase-owned tabs it no longer declares — so a capture bug
// would quietly delete someone's work two commands later.
//
// Ownership is therefore established from the seed ledger, which the seeder writes as it
// creates each automation and tab. Nothing is inferred from names: a personal tab called
// Agriculture, or a personal automation called Water Management, is not the showcase's.

/**
 * @param {object} input
 * @param {{tab: {id: string}, automations?: {key: string}[]}[]} input.tabModules
 * @param {{automations: Map<string, string>}} input.ledger key → ruleId, from the seeder
 * @param {{id?: string}[]} input.liveTabs
 * @param {object[]} input.livePanes
 * @param {Record<string, object[]>} [input.previous] The committed layout, for noticing
 *   a pane that has disappeared rather than silently dropping it.
 * @returns {{tabs: Record<string, object[]>, skipped: string[]}}
 */
export function deriveCapturedLayout({ tabModules, ledger, liveTabs, livePanes, previous = {} }) {
  const skipped = [];
  const tabs = {};

  /** ruleId → automation key, for the automations the seeder created. */
  const keyByRuleId = new Map([...ledger.automations].map(([key, ruleId]) => [ruleId, key]));
  /** Which tab declares each automation, so a pane cannot be filed under another. */
  const tabByKey = new Map();
  for (const mod of tabModules) {
    for (const automation of mod.automations || []) tabByKey.set(automation.key, mod.tab.id);
  }

  // Driven by the declared modules, not by what is on the dashboard. That is what keeps a
  // personal tab out: it is never even considered. It also means a declared tab missing
  // from the dashboard is reported rather than dropped from the fixture.
  for (const mod of tabModules) {
    const tabId = mod.tab.id;
    if (!liveTabs.some((tab) => tab?.id === tabId)) {
      skipped.push(`tab ${tabId} is declared by the showcase but not on this dashboard`);
      continue;
    }

    const panes = livePanes
      .filter((pane) => pane?.tabId === tabId)
      // Row-major, so the committed order reads the way the tab looks and nudging one
      // pane produces a small diff.
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const out = [];
    for (const pane of panes) {
      if (!["x", "y", "w", "h"].every((axis) => Number.isInteger(pane?.[axis]))) {
        skipped.push(`a pane on ${tabId} has non-integer geometry`);
        continue;
      }
      const box = { x: pane.x, y: pane.y, w: pane.w, h: pane.h };

      if (pane.paneType === "device-grid") {
        out.push({ kind: "device-grid", ...box });
        continue;
      }
      if (pane.paneType !== "automation") {
        // A pane type the showcase does not use — a connector control someone dropped
        // onto a showcase tab. Not ours to carry.
        skipped.push(`a "${pane.paneType}" pane on ${tabId} is not a showcase pane type`);
        continue;
      }

      const ruleId = pane?.config?.ruleId;
      const key = typeof ruleId === "string" ? keyByRuleId.get(ruleId) : undefined;
      if (!key) {
        skipped.push(`a pane on ${tabId} shows an automation the showcase does not own`);
        continue;
      }
      if (tabByKey.get(key) !== tabId) {
        // Moving a showcase pane to another tab changes composition, not geometry.
        // Capturing it would make the fixture disagree with the tab modules, which the
        // seeder refuses — so it is reported here instead of written.
        skipped.push(`"${key}" was found on ${tabId} but is declared on ${tabByKey.get(key)}`);
        continue;
      }
      out.push({ kind: "automation", ref: key, ...box });
    }

    // An automation with no pane is normal — the History automations are headless by
    // design — but one that HAD a pane and lost it is worth saying out loud, because
    // capturing silently would delete it from the showcase on the next seed.
    const present = new Set(out.map((pane) => pane.ref).filter(Boolean));
    for (const pane of previous[tabId] || []) {
      if (pane.ref && !present.has(pane.ref)) {
        skipped.push(`"${pane.ref}" is in the committed layout but has no pane on ${tabId} now`);
      }
    }

    tabs[tabId] = out;
  }

  return { tabs, skipped };
}
