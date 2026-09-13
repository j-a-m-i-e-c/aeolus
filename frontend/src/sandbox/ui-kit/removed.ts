// frontend/src/sandbox/ui-kit/removed.ts — helpers that no longer exist, kept only to
// say so.
//
// ADR-0014 replaced the variable-length `commandLadder()` with the fixed four-stage
// `commandProof()`. The old shape derived one rung per recorded transition, so a command
// that could never acknowledge simply had no ACKNOWLEDGED rung — nothing on the surface
// distinguished "this device cannot acknowledge" from "acknowledgement was required and
// never came". Removing it was the point of that ADR, not an incidental cleanup.
//
// So these are NOT compatibility wrappers. Restoring working versions would put the
// misleading ladder back into any pane that called them, which is the one outcome the
// whole pass exists to prevent. They exist because of how a custom UI imports the kit:
// the module loader rewrites `import { commandLadder } from "@aeolus/ui"` into a
// destructure of the kit object, so a removed export is not an import error — it is
// `undefined`, and the pane dies later at "commandLadder is not a function" or, worse,
// "Cannot read properties of undefined (reading 'map')". Neither names the replacement.
//
// A function that throws deliberately turns that into a sentence an author can act on.
// The pane still fails, which is correct: it is asking for a rendering that would lie.

/** What replaced each removed helper, and the shape of the replacement. */
const REPLACEMENTS: Record<string, string> = {
  commandLadder:
    "commandProof(evidence) returns a fixed four-stage proof — REQUESTED, DISPATCHED, "
    + "ACKNOWLEDGED, OBSERVED — including the stages a device cannot reach, each with a "
    + "reason. Or render <CommandProofCard evidence={...}/> and skip the derivation.",
  commandVerdict:
    "commandProof(evidence) carries the verdict on the proof itself (`proven`, `settled`, "
    + "`tier`), so there is no separate verdict to derive.",
  rungProps:
    "proofStageProps(stage) styles one stage of a commandProof(), or let "
    + "<CommandProofCard/> do the rendering.",
  verdictProps:
    "proofHeadlineProps(proof) styles the headline of a commandProof(), or let "
    + "<CommandProofCard/> do the rendering.",
};

function removed(name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(
      `@aeolus/ui: ${name}() was removed. It rendered only the stages a command happened `
      + `to reach, so a stage a device can never reach was indistinguishable from one that `
      + `was required and never came. ${REPLACEMENTS[name]} See ADR-0014.`,
    );
  };
}

/**
 * Removed in ADR-0014. Throws, naming its replacement.
 *
 * @deprecated Use `commandProof()` or `<CommandProofCard/>`.
 */
export const commandLadder = removed("commandLadder");

/**
 * Removed in ADR-0014. Throws, naming its replacement.
 *
 * @deprecated Use `commandProof()`, whose result carries the verdict.
 */
export const commandVerdict = removed("commandVerdict");

/**
 * Removed in ADR-0014. Throws, naming its replacement.
 *
 * @deprecated Use `proofStageProps()` or `<CommandProofCard/>`.
 */
export const rungProps = removed("rungProps");

/**
 * Removed in ADR-0014. Throws, naming its replacement.
 *
 * @deprecated Use `proofHeadlineProps()` or `<CommandProofCard/>`.
 */
export const verdictProps = removed("verdictProps");

/** The names this module accounts for, so a test can hold the set to the ADR. */
export const REMOVED_HELPERS = Object.keys(REPLACEMENTS);
