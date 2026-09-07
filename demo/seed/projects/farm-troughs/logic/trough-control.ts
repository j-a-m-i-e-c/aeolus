// Trough-network telemetry, demo controls and refill policy.
import { refill, setAction } from "./refill";
type TroughSnapshot = {
    average: number;
    low: number;
    refilling: number;
    lowIds: unknown[];
    drinkingActive: boolean;
    /** True from cattle walking in until the last one has moved off. */
    herdPresent: boolean;
    /** idle · approaching · drinking · clearing · refilling, as the troughs report it. */
    phase: string;
    /** Paddock whose cluster this visit is using. */
    visitPaddock: string;
    /** Troughs the herd is drinking from, which the troughs only report while it is. */
    drinkingIds: unknown[];
    drinkingHead: number;
};
/** Join reported trough ids into a readable list for an operator-facing label. */
function troughList(ids: unknown[]): string {
    const names = ids.filter((id) => typeof id === "string") as string[];
    if (names.length === 0)
        return "";
    if (names.length === 1)
        return names[0];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
export function initialiseTroughState() {
    if (state.get("autoRefill") === undefined)
        state.set("autoRefill", true);
    if (state.get("refillCommandActive") === undefined)
        state.set("refillCommandActive", false);
    if (state.get("drinkScenarioRequested") === undefined)
        state.set("drinkScenarioRequested", false);
    if (state.get("drinkingActive") === undefined)
        state.set("drinkingActive", false);
    if (state.get("drinkingProgress") === undefined)
        state.set("drinkingProgress", 0);
    if (state.get("herdPresent") === undefined)
        state.set("herdPresent", false);
    if (state.get("troughPhase") === undefined)
        state.set("troughPhase", "idle");
    if (state.get("lastVisitPhase") === undefined)
        state.set("lastVisitPhase", "idle");
}
export async function handleTroughOperatorEvent(event: string | undefined) {
    if (event === "refill-troughs") {
        await refill("operator");
    }
    else if (event === "simulate-drinking") {
        if (Boolean(state.get("drinkScenarioRequested"))
            || Boolean(state.get("herdPresent"))
            || Boolean(state.get("refillCommandActive")))
            return;
        state.set("drinkScenarioRequested", true);
        events.emit("farm/sim/troughs-drink", {});
        // Which troughs the herd uses is decided by the simulated world, from the
        // paddock the collars say the cattle are in and a rotating cluster — so this
        // automation cannot know it yet. It used to name four fixed troughs here,
        // which stopped being true the moment visits started rotating. The specifics
        // arrive with the next telemetry publish; see publishVisitPhaseTransitions.
        setAction("DEMO · calling the herd in to water");
    }
    else if (event === "toggle-auto") {
        const enabled = state.get("autoRefill") === undefined ? true : Boolean(state.get("autoRefill"));
        const next = !enabled;
        state.set("autoRefill", next);
        setAction(next
            ? "Automatic refill enabled · acts after cattle leave"
            : "Automatic refill disabled · low troughs require operator action");
        if (next && !Boolean(state.get("herdPresent")))
            await refill("automatic");
    }
    else if (event === "reset-troughs") {
        events.emit("farm/sim/troughs-reset", {});
        state.set("lowActive", false);
        state.set("refillCommandActive", false);
        state.set("drinkScenarioRequested", false);
        state.set("drinkingActive", false);
        state.set("herdPresent", false);
        state.set("troughPhase", "idle");
        state.set("lastVisitPhase", "idle");
        state.set("drinkingProgress", 0);
        state.set("autoRefill", true);
        setAction("DEMO · trough network reset to nominal");
    }
}
export function projectTroughTelemetry(context: EventContext): TroughSnapshot {
    const source = context.state && typeof context.state === "object" ? context.state : {};
    const average = Math.max(0, Math.min(100, Number(source.average) || 0));
    const low = Math.max(0, Number(source.low) || 0);
    const refilling = Math.max(0, Number(source.refilling) || 0);
    const levels = Array.isArray(source.levels) ? source.levels : [];
    const lowIds = Array.isArray(source.lowIds) ? source.lowIds : [];
    const refillTargets = Array.isArray(source.refillTargets) ? source.refillTargets : [];
    const drinkingIds = Array.isArray(source.drinkingIds) ? source.drinkingIds : [];
    const drinkingHead = Math.max(0, Number(source.drinkingHead) || 0);
    const drinkingActive = Boolean(source.drinkingActive);
    const herdPresent = Boolean(source.herdPresent);
    const phase = String(source.phase || "idle");
    const drinkingProgress = Math.max(0, Math.min(100, Number(source.drinkingProgress) || 0));
    state.set("herdPresent", herdPresent);
    state.set("troughPhase", phase);
    state.set("visitPaddock", String(source.visitPaddock || "A"));
    state.set("troughAverage", average);
    state.set("troughLow", low);
    state.set("troughRefilling", refilling);
    state.set("troughLevels", levels);
    state.set("lowIds", lowIds);
    state.set("refillTargets", refillTargets);
    state.set("drinkingIds", drinkingIds);
    state.set("drinkingHead", drinkingHead);
    state.set("drinkingActive", drinkingActive);
    state.set("drinkingProgress", drinkingProgress);
    state.set("consumptionTodayLitres", Math.max(0, Number(source.consumptionTodayLitres) || 0));
    state.set("lastDrinkLitres", Math.max(0, Number(source.lastDrinkLitres) || 0));
    state.set("refillFlowLpm", Math.max(0, Number(source.refillFlowLpm) || 0));
    // The request is satisfied as soon as the herd is physically on its way in, not
    // only once they are drinking.
    if (herdPresent)
        state.set("drinkScenarioRequested", false);
    return {
        average, low, refilling, lowIds, drinkingActive, herdPresent,
        phase, visitPaddock: String(source.visitPaddock || "A"), drinkingIds, drinkingHead,
    };
}
/**
 * Narrate a herd visit from what the troughs report, as each stage begins.
 *
 * The paddock and the troughs in use are facts the simulated world decides and the
 * telemetry carries, so they belong here rather than in the button handler that only
 * asked for a visit. This is also the one place that can name the real troughs: the
 * network reports `drinkingIds` while cattle are drinking and blanks it either side.
 */
export function publishVisitPhaseTransitions(snapshot: TroughSnapshot) {
    const previous = String(state.get("lastVisitPhase") || "idle");
    if (snapshot.phase === previous)
        return;
    state.set("lastVisitPhase", snapshot.phase);
    const head = snapshot.drinkingHead > 0 ? snapshot.drinkingHead + " head" : "The herd";
    if (snapshot.phase === "approaching") {
        setAction(head + " walking in to the Paddock " + snapshot.visitPaddock + " troughs");
    }
    else if (snapshot.phase === "drinking") {
        const troughs = troughList(snapshot.drinkingIds);
        setAction(troughs
            ? head + " drinking from " + troughs
            : head + " drinking at the Paddock " + snapshot.visitPaddock + " troughs");
    }
    else if (snapshot.phase === "clearing") {
        setAction("Herd moving off the Paddock " + snapshot.visitPaddock + " troughs");
    }
}
export function publishTroughThresholdTransitions(snapshot: TroughSnapshot) {
    const lowActive = Boolean(state.get("lowActive"));
    if (snapshot.low > 0 && !lowActive) {
        state.set("lowActive", true);
        setAction(snapshot.low + " troughs below refill threshold · average " + Math.round(snapshot.average) + "%");
        events.emit("farm/troughs/low", { average: snapshot.average, low: snapshot.low, lowIds: snapshot.lowIds });
    }
    else if (snapshot.low === 0 && lowActive) {
        state.set("lowActive", false);
        setAction("Trough network recovered · all low points cleared");
        events.emit("farm/troughs/recovered", { average: snapshot.average });
    }
}
export async function reconcileAutomaticRefill(snapshot: TroughSnapshot) {
    // Automatic refill waits for the herd to clear entirely, so the manifold never
    // opens while cattle are still walking in or moving off.
    if (snapshot.low > 0
        && Boolean(state.get("autoRefill"))
        && !snapshot.herdPresent
        && snapshot.refilling === 0
        && !Boolean(state.get("refillCommandActive"))) {
        await refill("automatic");
    }
}
