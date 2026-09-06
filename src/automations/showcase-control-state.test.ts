// Control state is a platform promise, so it is enforced across the showcase.
//
// Workstream 8 replaced hand-rolled operator buttons with the @aeolus/ui control
// helpers for one reason: the bare HTML `disabled` attribute makes a control inert
// without making it look unavailable. An operator presses, nothing happens, and the
// pane has told them nothing. `frontend/src/sandbox/ui-kit/index.test.ts` proves the
// helpers themselves are honest — a disabled control is visibly unavailable, pending
// is announced, current reads as pressed rather than as an action.
//
// That test cannot prove the panes actually USE them. A new pane can reintroduce the
// exact bug the kit exists to prevent and every kit test stays green. This file is
// the missing half: it checks the authored source of every showcase pane.
//
// These are structural checks on source text, not behavioural ones. Showcase panes are
// authored TSX compiled for the sandbox iframe and there is no harness that renders
// them, so "this button is visibly unavailable" is not directly observable here. What
// IS observable, and what actually regressed in practice, is a button conveying
// availability through its own `disabled` attribute instead of through the kit.
//
// Known limitation: the demo-scenario exemption is positional. A real operator control
// placed after a pane's DEMO SCENARIO block would not be checked.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJECTS_ROOT, readProjectFiles } from "../../demo/seed/project-loader.mjs";

/**
 * The opening tag starting at `at`, tracking brace depth so a `>` inside a JSX
 * expression does not end it early. `onClick={() => act()}` is the common case.
 */
function openingTag(source: string, at: number): string {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(at, i + 1);
  }
  return source.slice(at);
}

interface PaneButton {
  /** Demo controls drive the scenario, not a device, and are styled separately by design. */
  inDemoBlock: boolean;
  /** A literal `disabled` attribute in the source, as opposed to one the kit supplied. */
  declaresDisabled: boolean;
  spreadsVisual: boolean;
  tag: string;
  /** Everything between the opening tag and `</button>`, including the label expression. */
  label: string;
}

interface Pane {
  id: string;
  source: string;
  buttons: PaneButton[];
}

/** Every authored showcase pane, read with the loader the seeder itself uses. */
function readPanes(): Pane[] {
  const panes: Pane[] = [];
  for (const entry of readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of readProjectFiles(entry.name)) {
      if (!file.path.startsWith("ui/") || !file.path.endsWith(".tsx")) continue;
      const source = file.content;
      const demoAt = source.indexOf("DEMO SCENARIO");
      const buttons: PaneButton[] = [];
      let at = 0;
      while ((at = source.indexOf("<button", at)) >= 0) {
        const tag = openingTag(source, at);
        const closeAt = source.indexOf("</button>", at);
        buttons.push({
          inDemoBlock: demoAt >= 0 && at > demoAt,
          declaresDisabled: /\bdisabled[=}]/.test(tag),
          spreadsVisual: tag.includes("{..."),
          tag,
          label: closeAt < 0 ? "" : source.slice(at + tag.length, closeAt),
        });
        at += "<button".length;
      }
      panes.push({ id: `${entry.name}/${file.path.slice("ui/".length)}`, source, buttons });
    }
  }
  return panes;
}

const panes = readPanes();
const operatorButtons = panes.flatMap((pane) =>
  pane.buttons.filter((button) => !button.inDemoBlock).map((button) => ({ pane: pane.id, ...button })),
);

// The panes the analysis pass named for underground mining. Listing them by name means
// deleting a pane fails here rather than quietly shrinking the covered set.
const MINING_PANES = [
  "mine-ventilation/VentilationControlPanel.tsx",
  "mine-dewatering/DewateringPanel.tsx",
  "mine-atmosphere/AtmosphericSafetyPanel.tsx",
  "mine-personnel/PersonnelMusterPanel.tsx",
];

describe("showcase control state", () => {
  it("found the authored panes to check", () => {
    // Guards against a vacuous pass: if the loader or the ui/ convention changes, the
    // enumeration could silently match nothing and every assertion below would hold.
    expect(panes.length).toBeGreaterThan(40);
    expect(operatorButtons.length).toBeGreaterThan(30);
  });

  it("never conveys unavailability through a bare disabled attribute", () => {
    // The regression this whole workstream was about. The kit's disabled and pending
    // states carry a muted palette, a cursor and an aria flag; `disabled={x}` alone
    // leaves a dead control looking exactly as pressable as a live one.
    const handRolled = operatorButtons.filter((button) => button.declaresDisabled && !button.spreadsVisual);
    expect(handRolled.map((button) => `${button.pane}: ${button.tag.slice(0, 120)}`)).toEqual([]);
  });

  it("keeps the disabled affordance inside the kit", () => {
    // `cursor: not-allowed` is the kit's to give. A pane writing it by hand is styling
    // a state rather than deriving one, which is how the palettes drifted apart before.
    const inlined = operatorButtons.filter((button) => button.tag.includes("not-allowed"));
    expect(inlined.map((button) => button.pane)).toEqual([]);
  });

  it("imports the control helpers rather than redefining them", () => {
    const offenders = panes
      .filter((pane) => /\b(control|toggleProps)\(/.test(pane.source))
      .filter((pane) => !pane.source.includes('from "@aeolus/ui"'))
      .map((pane) => pane.id);
    expect(offenders).toEqual([]);
  });

  it("says what a pending control is waiting for", () => {
    // The showcase rule is "Stopping pump…" over "Please wait". A lone gerund is the
    // same failure in shorter form: "Verifying…" tells an operator a wait exists but
    // not what is being waited on, which is the only part they cannot already see.
    // Panes that got this right name the thing — "Verifying floodlight command…",
    // "Waiting for collars to confirm…", "Starting pump…".
    const vague = operatorButtons.flatMap((button) => {
      const literals = button.label.match(/"[^"]*"/g) ?? [];
      return literals
        .filter((literal) => /^"[A-Za-z]+(ing|ING)…"$/.test(literal) || /please wait/i.test(literal))
        .map((literal) => `${button.pane}: ${literal}`);
    });
    expect(vague).toEqual([]);
  });

  it.each(MINING_PANES)("%s derives its operator controls from the kit", (paneId) => {
    // Mining is the tab the analysis pass called out by name: its panes gate actions on
    // conditions an operator cannot see coming (a fan already boosted, a muster in
    // progress), so an invisibly-disabled control there is at its most misleading.
    const pane = panes.find((candidate) => candidate.id === paneId);
    expect(pane, `${paneId} is missing`).toBeDefined();
    expect(pane!.source).toContain('from "@aeolus/ui"');
    const controls = pane!.buttons.filter((button) => !button.inDemoBlock);
    expect(controls.length).toBeGreaterThan(0);
    for (const button of controls) {
      expect(button.spreadsVisual, `unstyled control in ${paneId}: ${button.tag.slice(0, 120)}`).toBe(true);
    }
  });
});
