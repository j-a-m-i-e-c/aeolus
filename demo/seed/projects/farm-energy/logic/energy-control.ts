// Site-energy telemetry, demo controls and opportunity-load policy.
import { initialiseEnergyState, setAction, setCharger } from "./charger-policy";
export { initialiseEnergyState } from "./charger-policy";
type EnergySnapshot = {
    soc: number;
    solarKw: number;
    loadKw: number;
    chargerKw: number;
    allowed: boolean;
    chargerOn: boolean;
    pumpActive: boolean;
    netKw: number;
    headroomBeforeCharger: number;
};
export async function handleEnergyOperatorEvent(event: string | undefined) {
    if (event === "simulate-low-battery") {
        if (String(state.get("demoScenarioPending") || ""))
            return;
        state.set("demoScenarioPending", "low-reserve");
        events.emit("farm/sim/energy-low", {});
        setAction("DEMO · injecting cloud cover + low battery reserve");
    }
    else if (event === "restore-battery") {
        if (String(state.get("demoScenarioPending") || ""))
            return;
        state.set("demoScenarioPending", "restore");
        events.emit("farm/sim/energy-restore", {});
        setAction("DEMO · restoring nominal solar + battery reserve");
    }
    else if (event === "toggle-opportunity") {
        const enabled = state.get("autoOpportunity") === undefined
            ? true
            : Boolean(state.get("autoOpportunity"));
        const next = !enabled;
        state.set("autoOpportunity", next);
        if (!next)
            await setCharger(false, "operator disabled opportunity charging");
        else
            setAction("Automatic opportunity charging enabled · lowest-priority load");
    }
    else if (event === "reset-energy") {
        events.emit("farm/sim/energy-reset", {});
        state.set("autoOpportunity", true);
        state.set("chargerCommandPending", false);
        state.set("demoScenarioPending", "");
        setAction("DEMO · energy system reset to nominal");
    }
}
export function projectEnergyTelemetry(context: EventContext): EnergySnapshot {
    const source = context.state && typeof context.state === "object" ? context.state : {};
    const soc = Number(source.soc);
    const solarKw = Number(source.solarKw);
    const loadKw = Number(source.loadKw);
    const baseLoadKw = Number(source.baseLoadKw);
    const pumpKw = Number(source.pumpKw);
    const chargerKw = Number(source.chargerKw);
    const chargerOn = Boolean(source.chargerOn);
    const batteryAvailable = source.available !== false;
    const allowed = batteryAvailable && (isNaN(soc) || soc >= 30);
    if (!isNaN(soc))
        state.set("batterySoc", soc);
    if (!isNaN(solarKw))
        state.set("solarKw", solarKw);
    if (!isNaN(loadKw))
        state.set("loadKw", loadKw);
    if (!isNaN(baseLoadKw))
        state.set("baseLoadKw", baseLoadKw);
    if (!isNaN(pumpKw))
        state.set("pumpKw", pumpKw);
    if (!isNaN(chargerKw))
        state.set("chargerKw", chargerKw);
    const chargerIsOn = chargerOn || (!isNaN(chargerKw) && chargerKw > 0);
    const pumpActive = !isNaN(pumpKw) && pumpKw > 0.1;
    const netKw = (isNaN(solarKw) ? 0 : solarKw) - (isNaN(loadKw) ? 0 : loadKw);
    const headroomBeforeCharger = (isNaN(solarKw) ? 0 : solarKw)
        - Math.max(0, (isNaN(loadKw) ? 0 : loadKw) - (isNaN(chargerKw) ? 0 : chargerKw));
    state.set("chargerOn", chargerIsOn);
    state.set("batteryAvailable", batteryAvailable);
    state.set("allowed", allowed);
    state.set("netKw", netKw);
    state.set("solarMarginKw", headroomBeforeCharger);
    return { soc, solarKw, loadKw, chargerKw, allowed, chargerOn: chargerIsOn, pumpActive, netKw, headroomBeforeCharger };
}
export function publishEnergyPolicy(snapshot: EnergySnapshot) {
    const mode = !snapshot.allowed
        ? "reserve-protection"
        : snapshot.pumpActive && !snapshot.chargerOn
            ? "water-priority"
            : snapshot.chargerOn
                ? "opportunity-charging"
                : snapshot.netKw < 0
                    ? "battery-support"
                    : snapshot.netKw >= 0.4
                        ? "solar-surplus"
                        : "balanced";
    state.set("energyMode", mode);
    const pending = String(state.get("demoScenarioPending") || "");
    if (pending === "low-reserve" && (!snapshot.allowed || (!isNaN(snapshot.soc) && snapshot.soc <= 20))) {
        state.set("demoScenarioPending", "");
    }
    else if (pending === "restore" && snapshot.allowed && !isNaN(snapshot.soc) && snapshot.soc >= 70) {
        state.set("demoScenarioPending", "");
    }
    const previousAllowed = state.get("previousAllowed");
    state.set("previousAllowed", snapshot.allowed);
    if (!snapshot.allowed && previousAllowed !== false) {
        setAction("Reserve protection active · water transfer held and opportunity load shed");
    }
    else if (snapshot.allowed && previousAllowed === false) {
        setAction("Energy reserve restored · normal load policy resumed");
    }
    else if (previousAllowed === undefined) {
        setAction("Energy policy online · priorities: essential > water > charging");
    }
    events.emit("farm/energy/permission", {
        allowed: snapshot.allowed,
        soc: isNaN(snapshot.soc) ? null : snapshot.soc,
        solarKw: isNaN(snapshot.solarKw) ? null : snapshot.solarKw,
        loadKw: isNaN(snapshot.loadKw) ? null : snapshot.loadKw,
        mode,
    });
}
export async function reconcileOpportunityLoad(snapshot: EnergySnapshot) {
    const automatic = Boolean(state.get("autoOpportunity"));
    if (automatic && !snapshot.chargerOn && snapshot.allowed && !isNaN(snapshot.soc)
        && snapshot.soc >= 60 && snapshot.headroomBeforeCharger >= 0.65) {
        await setCharger(true, "solar headroom available after higher-priority loads");
        return;
    }
    if (snapshot.chargerOn
        && (!automatic || !snapshot.allowed || (!isNaN(snapshot.soc) && snapshot.soc < 45)
            || snapshot.netKw < 0.2 || (snapshot.pumpActive && snapshot.netKw < 0.35))) {
        await setCharger(false, !snapshot.allowed
            ? "reserve protection"
            : snapshot.pumpActive
                ? "water transfer given priority"
                : snapshot.netKw < 0.2
                    ? "solar headroom exhausted"
                    : "automatic control disabled");
    }
}
