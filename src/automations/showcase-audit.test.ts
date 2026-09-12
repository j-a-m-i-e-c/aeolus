// showcase-cleanup §8 — the audit, applied to every seeded tab rather than the ones the
// spec happened to name.
//
// Phases 3 to 6 fixed the same handful of defects over and over, one domain at a time:
// a command that left no receipt, a number with no source, a glyph nobody could decode,
// a pane inventing a position. Each fix landed with a test scoped to its own domain,
// which meant the next domain was free to have the same defect.
//
// So the invariants are hoisted here and applied to all of them. Where a project has a
// legitimate exception it is named with a reason, because "this one is different" is
// sometimes true and should be written down rather than discovered later.
//
// Proof TIERS are not audited here — src/automations/showcase-proof-tier.test.ts already
// holds every command to a defended tier and bans command-echo conditions.

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
import { tabModules } from "../../demo/seed/tabs/index.mjs";

const PROJECTS_DIR = join(process.cwd(), "demo", "seed", "projects");

interface Project {
  name: string;
  logic: string;
  ui: string;
  /** Whether the project has a demo-only stimulus module, by project convention. */
  hasDemoActions: boolean;
}

function readProjects(): Project[] {
  return readdirSync(PROJECTS_DIR)
    .filter((entry) => {
      try {
        return statSync(join(PROJECTS_DIR, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((name) => {
      const { scriptSource, uiSource } = readSeedProjectSource(name);
      let hasDemoActions = false;
      try {
        hasDemoActions = statSync(join(PROJECTS_DIR, name, "ui", "demo-actions.ts")).isFile();
      } catch {
        hasDemoActions = false;
      }
      return { name, logic: scriptSource, ui: uiSource, hasDemoActions };
    });
}

const PROJECTS = readProjects();
const COMMANDING = PROJECTS.filter((p) => p.logic.includes("devices.action("));
const WITH_UI = PROJECTS.filter((p) => p.ui.trim().length > 0);

const count = (source: string, pattern: RegExp): number => [...source.matchAll(pattern)].length;

describe("showcase audit — every seeded tab", () => {
  it("has projects to audit, and every one is reachable from a tab", () => {
    // A project nobody seeds is a project nobody maintains.
    expect(PROJECTS.length).toBeGreaterThan(0);
    const referenced = new Set(
      (tabModules as Array<{ automations?: Array<{ projectDir?: string }> }>)
        .flatMap((mod) => mod.automations ?? [])
        .map((automation) => automation.projectDir)
        .filter((dir): dir is string => Boolean(dir)),
    );
    for (const project of PROJECTS) {
      expect(referenced, `${project.name} is not seeded by any tab`).toContain(project.name);
    }
  });

  // §2.5, §4.4 — a command with no receipt is a physical action the operator cannot
  // inspect. Every project that issues commands must project evidence for all of them.
  it.each(COMMANDING.map((p) => [p.name, p] as const))(
    "%s leaves a receipt for every command it issues",
    (_name, project) => {
      const commands = count(project.logic, /devices\.action\(/g);
      // A project whose trigger issues several commands at once groups them under the
      // execution instead, which is one receipt covering all of them by design (§2.7).
      // Requiring per-command receipts there would push it back to reporting whichever
      // command happened to settle last.
      if (project.logic.includes("devices.executionEvidence(")) {
        expect(project.logic).toContain('state.set("lastExecution"');
        return;
      }
      const receipts = count(project.logic, /devices\.commandEvidence\(/g);
      expect(receipts, `${commands} commands but ${receipts} receipts`).toBe(commands);
    },
  );

  // §2.4 — "device_action" tells an operator nothing. Every command names the operation
  // it is, so a receipt is legible beside the control that caused it.
  //
  // At least one intent per command rather than exactly one: a command whose intent is
  // chosen by a ternary declares two strings for one call site, which is fine.
  it.each(COMMANDING.map((p) => [p.name, p] as const))(
    "%s names the intent of every command",
    (_name, project) => {
      const commands = count(project.logic, /devices\.action\(/g);
      const intents = count(project.logic, /intent:/g);
      expect(intents, `${commands} commands but ${intents} intents`).toBeGreaterThanOrEqual(commands);
    },
  );

  // §2.5 from the other side: a receipt the Logic records and the pane never renders is
  // invisible proof, and a card with nothing feeding it renders an empty surface. Both
  // halves have to exist together, and the pairing has to match — a project that groups
  // its commands under one execution needs the execution card, not the single-command one.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s renders the receipt it records, and records the receipt it renders",
    (_name, project) => {
      const recordsCommand = /state\.set\(\s*["']lastCommand["']/.test(project.logic);
      const recordsExecution = /state\.set\(\s*["']lastExecution["']/.test(project.logic);
      const rendersCommand = project.ui.includes("CommandProofCard");
      const rendersExecution = project.ui.includes("CommandExecutionCard");

      expect(rendersCommand, "records lastCommand but renders no CommandProofCard").toBe(
        recordsCommand,
      );
      expect(
        rendersExecution,
        "records lastExecution but renders no CommandExecutionCard",
      ).toBe(recordsExecution);
    },
  );

  // §13.4 — for every number shown, something must be able to answer "what produced
  // this?". A UI reading devices directly cannot, because a public-demo visitor is not
  // granted device visibility and the pane would render static defaults.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s renders only its own projection, never devices directly",
    (_name, project) => {
      expect(project.ui).not.toContain("aeolus.devices");
    },
  );

  // The same rule from the other side: a key the pane reads but the logic never writes
  // renders a default and looks alive while being dead.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s writes every projection key its UI reads",
    (_name, project) => {
      const written = new Set(
        [...project.logic.matchAll(/state\.set\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
      );
      // The aggregating panes set their keys through a whitelist copier — `state.set(key,
      // ...)` over an array of names — so a literal-key scan cannot see them. Where the
      // logic writes state under a computed key, fall back to requiring the name to
      // appear as a literal somewhere in it. That still catches a key the logic has never
      // heard of, which is the failure worth catching.
      const dynamic = /state\.set\(\s*[A-Za-z_$]/.test(project.logic);
      const read = [...project.ui.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const key of read) {
        const known = written.has(key)
          || (dynamic && new RegExp(`["']${key}["']`).test(project.logic));
        expect(known, `UI reads "${key}" but the Logic never writes it`).toBe(true);
      }
    },
  );

  // Text a visitor reads must survive the trip from the editor to the pane.
  //
  // Five panes shipped with their UTF-8 re-encoded through CP1252, so every em dash,
  // middle dot, ellipsis, arrow and superscript in them turned into a run of two to six
  // Latin-1 characters — in pane subtitles, SVG footers and button labels a visitor
  // reads. Every existing invariant looked straight past it, because they all match on
  // identifiers or on prose that was still spelt correctly.
  //
  // The damage is detectable on its own terms without hard-coding the mangled sequences:
  // a CP1252 round trip always produces U+00C3 or U+00C2 immediately followed by another
  // non-ASCII character, and correctly encoded prose has no reason to do that.
  it.each(PROJECTS.map((p) => [p.name, p] as const))(
    "%s source is not mojibake-corrupted",
    (_name, project) => {
      for (const [layer, source] of [
        ["logic", project.logic],
        ["ui", project.ui],
      ] as const) {
        // Escaped rather than written literally, so this file does not itself trip a
        // repo-wide scan for the very sequences it exists to reject.
        const hits = [...source.matchAll(/[\u00C3\u00C2][\u0080-\u02FF\u2000-\u206F]/g)].map(
          (m) => m[0],
        );
        expect(
          hits,
          `${layer} contains CP1252 round-trip damage: ${[...new Set(hits)].join(" ")}`,
        ).toEqual([]);
      }
    },
  );

  // §13.3 — if a visitor cannot explain a symbol from context, label it. The water
  // schematic's "V" for valve was the case that prompted this; a bare one-character
  // SVG text node is the shape of that mistake.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s draws no unexplained single-letter glyph",
    (_name, project) => {
      const glyphs = [...project.ui.matchAll(/>\s*([A-Za-z])\s*<\/text>/g)].map((m) => m[1]);
      expect(glyphs, `unexplained glyph(s): ${glyphs.join(", ")}`).toEqual([]);
    },
  );

  // §13.2 — a control that injects a condition into simulated hardware is not an
  // operator control and must not be presented as one.
  //
  // Keyed on the presence of ui/demo-actions.ts, which by the project convention exists
  // exactly when a pane has demo-only controls. Keying it on the logic emitting a `/sim/`
  // topic would be wrong: Game Master resets the room through the room's own reset path
  // as part of starting a game, which is a real operator action, not a demo control.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s separates demo-world injection from real operator controls",
    (_name, project) => {
      // Only that demo controls are labelled as such. Requiring an OPERATOR section
      // alongside would be wrong: Puzzle Progress and Wildlife Detection are observation
      // panes whose physical work is done by participants or by another automation, so
      // having nothing for an operator to press is the correct answer for them.
      if (!project.hasDemoActions) return;
      expect(project.ui, "has demo-only controls but no DEMO SCENARIO block").toContain("DEMO SCENARIO");
    },
  );

  // §9.1 — devices.list() is a per-execution snapshot, serialised once before the script
  // runs. Re-reading it after a command therefore projects the world as it was BEFORE the
  // command, which is not a subtle staleness: it flips booleans back, republishes the
  // pre-command state to the domain overviews, and produced sentences that disproved
  // themselves ("verified moving air at 0 rpm").
  //
  // A command's own commanded values are the only thing an automation may write on
  // settlement. Anything a device owns waits for that device to publish.
  it.each(COMMANDING.map((p) => [p.name, p] as const))(
    "%s does not re-read the device snapshot after a command",
    (_name, project) => {
      // Comments mention these functions when explaining the trap, so the check runs on
      // code with the comments stripped.
      const code = project.logic
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      // Any function that reaches devices.list(), directly or through a helper.
      const bodies = new Map<string, string>();
      for (const m of code.matchAll(
        /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([\s\S]*?\n\}/g,
      )) {
        bodies.set(m[1], m[0]);
      }
      const readers = new Set(
        [...bodies].filter(([, body]) => body.includes("devices.list(")).map(([name]) => name),
      );
      for (let changed = true; changed; ) {
        changed = false;
        for (const [name, body] of bodies) {
          if (readers.has(name)) continue;
          if ([...readers].some((r) => new RegExp(`\\b${r}\\(`).test(body))) {
            readers.add(name);
            changed = true;
          }
        }
      }

      const offenders = new Set<string>();
      for (const match of code.matchAll(/await devices\.action\(/g)) {
        // The rest of the enclosing function: these files close top-level functions with
        // a brace at column 0.
        const rest = code.slice(match.index);
        const end = rest.search(/\n\}/);
        const tail = end === -1 ? rest : rest.slice(0, end);
        for (const reader of readers) {
          if (new RegExp(`\\b${reader}\\(`).test(tail)) offenders.add(reader);
        }
      }
      expect(
        [...offenders],
        `called after devices.action(), which can only see pre-command state`,
      ).toEqual([]);
    },
  );

  // §2.9 — DISPATCHED means Aeolus handed the command to the transport. It does not mean
  // the device received it, and no showcase pane may say otherwise.
  it.each(WITH_UI.map((p) => [p.name, p] as const))(
    "%s never claims a dispatch proved the device received it",
    (_name, project) => {
      expect(project.ui).not.toMatch(/[Ss]ent to the device/);
      expect(project.logic).not.toMatch(/[Ss]ent to the device/);
    },
  );
});
