// Trough-network telemetry, demo controls and refill policy.
import { refill, setAction } from "./refill";
type TroughSnapshot = {
    average: number;
    low: number;
    refilling: number;
    lowIds: unknown[];
    drinkingActive: boolean;
};
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
}
export async function handleTroughOperatorEvent(event: string | undefined) {
    if (event === "refill-troughs") {
        await refill("operator");
    }
    else if (event === "simulate-drinking") {
        if (Boolean(state.get("drinkScenarioRequested"))
            || Boolean(state.get("drinkingActive"))
            || Boolean(state.get("refillCommandActive")))
            return;
        state.set("drinkScenarioRequested", true);
        events.emit("farm/sim/troughs-drink", {});
        setAction("DEMO · herd arriving at T4, T5, T12 and T17");
    }
    else if (event === "toggle-auto") {
        const enabled = state.get("autoRefill") === undefined ? true : Boolean(state.get("autoRefill"));
        const next = !enabled;
        state.set("autoRefill", next);
        setAction(next
            ? "Automatic refill enabled · acts after cattle leave"
            : "Automatic refill disabled · low troughs require operator action");
        if (next && !Boolean(state.get("drinkingActive")))
            await refill("automatic");
    }
    else if (event === "reset-troughs") {
        events.emit("farm/sim/troughs-reset", {});
        state.set("lowActive", false);
        state.set("refillCommandActive", false);
        state.set("drinkScenarioRequested", false);
        state.set("drinkingActive", false);
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
    const drinkingProgress = Math.max(0, Math.min(100, Number(source.drinkingProgress) || 0));
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
    if (drinkingActive)
        state.set("drinkScenarioRequested", false);
    return { average, low, refilling, lowIds, drinkingActive };
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
    if (snapshot.low > 0
        && Boolean(state.get("autoRefill"))
        && !snapshot.drinkingActive
        && snapshot.refilling === 0
        && !Boolean(state.get("refillCommandActive"))) {
        await refill("automatic");
    }
}
