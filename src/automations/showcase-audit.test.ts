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

  // A raised spinner must always come back down.
  //
  // Every commanding pane disables its control and shows a wait while a command is in
  // flight, driven by a flag the Logic raises before `devices.action()` and clears after.
  // An early return between those two lines leaves the flag raised for good: the pane
  // spins forever and the control never becomes pressable again, so the tab is dead until
  // the automation is edited. mine-dewatering did exactly this when the sump level sensor
  // was missing — it reported the problem and returned, with `commandPending` still true.
  //
  // Deliberately not solved by wrapping the awaits in try/finally. `devices.action()` does
  // not throw: the host callback catches everything, including an unexpected error inside
  // CommandService, and resolves with a failure ActionResult (see the __actionRef
  // reference in sandbox.ts). Guarding against a rejection the platform contract prevents
  // would add noise to nineteen projects and still not catch the bug that actually
  // happened, which was an ordinary early return.
  it.each(COMMANDING.map((p) => [p.name, p] as const))(
    "%s always lowers a spinner it raises",
    (_name, project) => {
      // The flags the pane genuinely uses as spinners, read off the UI rather than
      // guessed from names: whatever it hands to control()/toggleProps() as `pending`,
      // plus the naming conventions the projects use for the same idea.
      const spinners = new Set<string>();
      for (const match of project.ui.matchAll(/pending:\s*([^,}\n]+)/g)) {
        for (const key of match[1].matchAll(/model\.([A-Za-z0-9_$]+)/g)) spinners.add(key[1]);
      }
      for (const match of project.ui.matchAll(
        /aeolus\.read\(\s*"([A-Za-z0-9_$]*(?:[Pp]ending[A-Za-z0-9_$]*|InProgress|CommandActive))"/g,
      )) {
        spinners.add(match[1]);
      }

      const stranded: string[] = [];
      for (const flag of spinners) {
        const raise = new RegExp(`state\\.set\\(\\s*"${flag}"\\s*,\\s*true\\s*\\)`, "g");
        for (const match of project.logic.matchAll(raise)) {
          // The rest of the enclosing function; these files close at column 0.
          const rest = project.logic.slice(match.index);
          const end = rest.search(/\n\}/);
          const body = end === -1 ? rest : rest.slice(0, end);
          const clearAt = body.search(
            new RegExp(`state\\.set\\(\\s*"${flag}"\\s*,\\s*false\\s*\\)`),
          );
          if (clearAt === -1) {
            stranded.push(`${flag} is raised and never lowered`);
            continue;
          }
          // A return before the clear abandons the flag on that path. A project that
          // legitimately hands the clear to another function would show up here and needs
          // a named exception rather than a quiet loosening of the rule.
          const beforeClear = body.slice(0, clearAt);
          if (/\n\s*return\b/.test(beforeClear)) {
            stranded.push(`${flag} is left raised by an early return`);
          }
        }
      }
      expect([...new Set(stranded)]).toEqual([]);
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

      // Every top-level function in the project, by name. Arrow-assigned helpers and the
      // `export default async function run` entry point are both included: the entry
      // point is exactly where a caller-side re-read hides, so missing it would leave the
      // most likely instance of this bug invisible.
      const bodies = new Map<string, string>();
      const declaration =
        /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([\s\S]*?\n\}/g;
      for (const m of code.matchAll(declaration)) bodies.set(m[1], m[0]);
      const arrow =
        /(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]*)?=>\s*\{[\s\S]*?\n\}/g;
      for (const m of code.matchAll(arrow)) bodies.set(m[1], m[0]);

      /** Names whose bodies reach `marker`, directly or through any helper they call. */
      const reaching = (marker: string): Set<string> => {
        const found = new Set(
          [...bodies].filter(([, body]) => body.includes(marker)).map(([name]) => name),
        );
        for (let changed = true; changed; ) {
          changed = false;
          for (const [name, body] of bodies) {
            if (found.has(name)) continue;
            if ([...found].some((f) => new RegExp(`\\b${f}\\s*\\(`).test(body))) {
              found.add(name);
              changed = true;
            }
          }
        }
        return found;
      };
      const readers = reaching("devices.list(");
      const commanders = reaching("devices.action(");

      // Anything that issues a command, whether written inline, awaited or not, or
      // reached through a helper. Restricting this to a literal `await devices.action(`
      // was the gap: Game Master's entry point awaited a helper that commanded, then
      // called a projection, and the check could not see across that boundary.
      const commandCalls = [
        "devices\\.action\\(",
        ...[...commanders].map((name) => `\\b${name}\\s*\\(`),
      ];

      const offenders = new Set<string>();
      for (const [owner, body] of bodies) {
        for (const pattern of commandCalls) {
          for (const match of body.matchAll(new RegExp(pattern, "g"))) {
            // A command reached through the enclosing function itself is recursion, not a
            // re-read; skip it so a commander does not flag its own name.
            if (new RegExp(`^\\b${owner}\\s*\\(`).test(match[0])) continue;
            const at = match.index! + match[0].length;
            // Only what can still run after the command on the same path.
            //
            // Two ways to leave that path, and both matter.
            //
            // Closing past the command's own block means the rest belongs to a sibling
            // branch. And for a brace-less arm there is no block to close, so an `else`
            // ends the path instead: the operator-event dispatchers are written
            // `if (e === "pump-on") await command(...)` followed by
            // `else if (e === "toggle-auto") { project(); }`, and those two calls can never
            // both run.
            //
            // That `else` rule has to be narrow or it swallows the common case. A command
            // followed by its own `if (result.success) { … } else { … }` and THEN a
            // projection is the original defect, and an unconditional `else` break would
            // stop the scan at that `else` and miss it. So the break only applies while no
            // complete block has been passed yet — which is exactly the brace-less arm.
            //
            // Stated limit: a command nested inside a conditional block, whose projection
            // comes after that block closes, is not seen. Both real shapes of this defect
            // are — same-depth within a function, and a caller projecting after an awaited
            // helper.
            let depth = 0;
            let sawBlock = false;
            let tail = "";
            for (let i = at; i < body.length; i += 1) {
              const ch = body[i];
              if (ch === "{") depth += 1;
              else if (ch === "}") {
                depth -= 1;
                if (depth < 0) break;
                if (depth === 0) sawBlock = true;
              }
              if (
                !sawBlock
                && depth === 0
                && body.startsWith("else", i)
                && /\s/.test(body[i - 1] ?? " ")
              ) {
                break;
              }
              tail += ch;
            }
            for (const reader of readers) {
              if (commanders.has(reader)) continue;
              if (new RegExp(`\\b${reader}\\s*\\(`).test(tail)) {
                offenders.add(`${owner} -> ${reader}`);
              }
            }
          }
        }
      }
      expect(
        [...offenders],
        `a projection that reads devices.list() runs after a command, so it can only see pre-command state`,
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
