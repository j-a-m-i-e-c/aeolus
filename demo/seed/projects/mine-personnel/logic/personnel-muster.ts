// Personnel tracking and verified muster control.
/**
 * Crew underground, and therefore the refuge occupancy a complete muster reaches.
 *
 * Named because it is the number the observation waits for: a muster is proven when
 * everyone who was down there is accounted for, not when the alarm starts.
 */
const MUSTER_HEADCOUNT = 14;

function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectPersonnelState() {
    const people = byTopic("sensor/mine/personnel");
    const muster = byTopic("switch/mine/muster/state");
    const personnel = people && people.state ? people.state : {};
    const musterState = muster && muster.state ? muster.state : {};
    state.set("underground", Number(personnel.underground || 0));
    state.set("l1", Number(personnel.l1 || 0));
    state.set("l2", Number(personnel.l2 || 0));
    state.set("l3", Number(personnel.l3 || 0));
    state.set("refuge", Number(personnel.refuge || 0));
    state.set("unaccounted", Number(personnel.unaccounted || 0));
    state.set("musterState", String(personnel.musterState || musterState.state || "normal"));
    state.set("alarmActive", Boolean(musterState.alarm));
    state.set("musterActive", Boolean(musterState.active));
    events.emit("mine/summary/personnel", {
        underground: Number(personnel.underground || 0),
        l1: Number(personnel.l1 || 0),
        l2: Number(personnel.l2 || 0),
        l3: Number(personnel.l3 || 0),
        refuge: Number(personnel.refuge || 0),
        unaccounted: Number(personnel.unaccounted || 0),
        musterState: String(personnel.musterState || musterState.state || "normal"),
        alarmActive: Boolean(musterState.alarm),
    });
}
export async function commandMuster(active: boolean) {
    const controller = byTopic("switch/mine/muster/state");
    if (!controller) {
        setAction("Muster controller unavailable");
        return;
    }
    state.set("commandPending", true);
    setAction(active
        ? "Initiating underground personnel muster"
        : "Clearing muster and returning to normal operations");
    // Proven by people actually reaching the refuge, not by the alarm agreeing it
    // was armed.
    //
    // The muster controller republishes `active` the moment it accepts, so observing
    // it proves only that the alarm sounded. What an operator needs to know is
    // whether the underground crew got out, and that is the personnel tracking
    // network's answer: refuge occupancy climbs 4 → 8 → 12 → 14 over about three
    // seconds. A generous window, because the physical thing being waited on is
    // people walking.
    const tracking = byTopic("sensor/mine/personnel");
    if (!tracking) {
        setAction("Personnel tracking unavailable · a muster cannot be verified");
        state.set("commandPending", false);
        return;
    }
    const result = await devices.action(controller.id, "command", { payload: { active } }, {
        tier: "observed",
        deviceId: tracking.id,
        condition: active
            ? { field: "refuge", op: "gte", value: MUSTER_HEADCOUNT }
            // Clearing returns the crew to their working levels, so the refuge empties.
            : { field: "refuge", op: "eq", value: 0 },
        timeoutMs: active ? 9000 : 5000,
        evidence: {
            intent: active ? "Muster underground personnel" : "Clear muster",
            observedLabel: active ? "all crew accounted for in the refuge" : "refuge cleared",
        },
    });
    state.set("commandPending", false);
    // Keep the proof, not just the verdict. The observation named on the card is the
    // personnel tracking network, not the muster controller — which is the whole
    // argument of this command, and worth showing rather than only commenting.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (!result.success) {
        setAction("Muster command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
    else {
        setAction(active ? "Muster alarm verified · tracking personnel to refuge" : "Muster cleared");
    }
    projectPersonnelState();
}
export function handlePersonnelDemoEvent(event: string | undefined) {
    if (event === "simulate-tag-dropout") {
        events.emit("mine/sim/tag-dropout", {});
        setAction("Injecting one temporary personnel-tag dropout");
    }
    else if (event === "reset-personnel") {
        events.emit("mine/sim/personnel-reset", {});
        setAction("Resetting personnel distribution");
    }
}
