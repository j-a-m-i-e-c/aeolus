// Livestock telemetry and demo-event implementation.
import { recallStrays, setAction } from "./recall";
export function initialiseLivestockState() {
    if (state.get("demoScenarioPending") === undefined)
        state.set("demoScenarioPending", "");
}
export async function handleLivestockOperatorEvent(event: string | undefined) {
    if (event === "recall-strays") {
        await recallStrays();
        return;
    }
    if (event === "reset-livestock") {
        events.emit("farm/sim/livestock-reset", {});
        state.set("recallInProgress", false);
        state.set("demoScenarioPending", "");
        setAction("DEMO · livestock system reset to nominal");
        return;
    }
    if (String(state.get("demoScenarioPending") || ""))
        return;
    if (event === "simulate-strays") {
        state.set("demoScenarioPending", "breach");
        events.emit("farm/sim/livestock-boundary-breach", {});
        setAction("DEMO · injecting east-boundary crossing");
    }
    else if (event === "move-herd") {
        state.set("demoScenarioPending", "move");
        events.emit("farm/sim/livestock-move-herd", {});
        setAction("DEMO · injecting paddock movement");
    }
    else if (event === "simulate-fence-fault") {
        state.set("demoScenarioPending", "fault");
        events.emit("farm/sim/livestock-fence-fault", {});
        setAction("DEMO · injecting perimeter energiser fault");
    }
    else if (event === "restore-fence") {
        state.set("demoScenarioPending", "restore");
        events.emit("farm/sim/livestock-fence-restore", {});
        setAction("DEMO · restoring perimeter energiser");
    }
}
export function projectCollarTelemetry(context: EventContext) {
    const source = context.state && typeof context.state === "object" ? context.state : {};
    const strays = Math.max(0, Number(source.strays) || 0);
    const herd = Math.max(0, Number(source.herd) || 0);
    const tracked = Math.max(0, Number(source.tracked) || 0);
    const avgBattery = Math.max(0, Math.min(100, Number(source.avgBattery) || 0));
    const paddock = String(source.paddock || "A");
    const breachSector = String(source.breachSector || "");
    const movement = String(source.movement || "grazing");
    state.set("strays", strays);
    state.set("herd", herd);
    state.set("tracked", tracked);
    state.set("avgBattery", avgBattery);
    state.set("paddock", paddock);
    state.set("breachSector", breachSector);
    state.set("movement", movement);
    if (state.get("recallInProgress") === undefined)
        state.set("recallInProgress", false);
    const pending = String(state.get("demoScenarioPending") || "");
    if ((pending === "breach" && strays > 0) || (pending === "move" && movement === "rotating")) {
        state.set("demoScenarioPending", "");
    }
    const previous = Number(state.get("lastStrays"));
    state.set("lastStrays", strays);
    if (strays > 0 && previous !== strays) {
        setAction(strays + " collars outside the virtual boundary · " + (breachSector || "sector unknown"));
        events.emit("farm/livestock/breach", { strays, herd, tracked, sector: breachSector });
    }
    else if (strays === 0 && previous > 0) {
        setAction("Herd contained · all tracked collars inside boundary");
        events.emit("farm/livestock/contained", { herd, tracked, paddock });
    }
}
export function projectDogTelemetry(context: EventContext) {
    const source = context.state && typeof context.state === "object" ? context.state : {};
    const dogs = Array.isArray(source.dogs) ? source.dogs : [];
    // Projected for the pane to draw. Deliberately never used to decide whether the
    // herd is contained: that remains the cattle collars' observation, so the dogs
    // stay a depiction of the work rather than a second source of truth.
    state.set("dogs", dogs);
    state.set("dogsWorking", source.working === true);
    state.set("dogsDeployed", Math.max(0, Number(source.deployed) || 0));
}
export function projectFenceTelemetry(context: EventContext) {
    const source = context.state && typeof context.state === "object" ? context.state : {};
    const voltage = Number(source.voltage);
    const current = Number(source.current);
    const fault = source.fault === true;
    if (!isNaN(voltage))
        state.set("voltage", voltage);
    if (!isNaN(current))
        state.set("fenceCurrent", current);
    state.set("fenceFault", fault);
    const pending = String(state.get("demoScenarioPending") || "");
    if ((pending === "fault" && fault) || (pending === "restore" && !fault)) {
        state.set("demoScenarioPending", "");
    }
    const previousFault = Boolean(state.get("lastFenceFault"));
    state.set("lastFenceFault", fault);
    if (fault && !previousFault) {
        setAction("Perimeter energiser fault · physical boundary protection degraded");
        events.emit("farm/livestock/fence-fault", { voltage });
    }
    else if (!fault && previousFault) {
        setAction("Perimeter energiser restored");
        events.emit("farm/livestock/fence-restored", { voltage });
    }
}
