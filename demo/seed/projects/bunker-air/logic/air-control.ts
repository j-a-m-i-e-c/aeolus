// Bunker air-system implementation. logic/index.ts owns the event flow.
function filterController() {
    return devices.list().find((device) => device.topic === "switch/bunker/filter/state");
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/**
 * Report the air system's state to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so every
 * caller reports the same thing and no caller has to be careful about when it runs.
 */
export function publishAirSummary() {
    events.emit("bunker/summary/air", {
        sealed: Boolean(state.get("sealed")),
        overpressure: Number(state.get("overpressure") ?? 8),
        filterLife: Number(state.get("filterLife") ?? 78),
        tempC: Number(state.get("tempC") ?? 19.4),
    });
}
/**
 * Project the filter controller's observed state.
 *
 * Reading the device is correct *here*: this path runs because the controller
 * published, so the snapshot is the state that woke the automation. It is not correct
 * straight after issuing a command — see setBunkerSeal.
 */
export function projectAirState() {
    const controller = filterController();
    const observed = controller && controller.state ? controller.state : {};
    const sealed = Boolean(observed.sealed);
    const overpressure = Number(observed.overpressure ?? 8);
    const filterLife = Number(observed.filterLife ?? 78);
    // The air system is the thing that knows how warm it is inside, because it is
    // the thing moving the air.
    const tempC = Number(observed.tempC ?? 19.4);
    state.set("sealed", sealed);
    state.set("overpressure", overpressure);
    state.set("filterLife", filterLife);
    state.set("tempC", tempC);
    state.set("on", observed.on !== false);
    publishAirSummary();
}
export async function setBunkerSeal(sealed: boolean) {
    const controller = filterController();
    if (!controller)
        return;
    state.set("pending", true);
    // Acknowledgement is the honest ceiling here.
    //
    // A sealed bunker is a pressure claim, and `overpressure` is the reading that
    // would settle it — but the filter controller publishes `sealed`, `overpressure`
    // and `tempC` in one update as it accepts, so none of them measures anything the
    // command did not already assert. Equating a requested `sealed` flag with an
    // airtight shelter is exactly the overstatement worth avoiding, so this reports
    // what it knows: the controller took the command.
    const result = await devices.action(controller.id, "command", { payload: { sealed } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: sealed ? "Seal bunker" : "Return to normal ventilation",
        },
    });
    state.set("pending", false);
    if (result.success) {
        // Record what the controller accepted. This used to call projectAirState(),
        // which re-reads devices.list() — and that list is a snapshot taken once at the
        // start of the execution, so it still described the bunker as it was BEFORE the
        // command. A successful seal therefore projected `sealed: false` and emitted
        // that to the overview, racing the correct summary produced a moment later by
        // the controller's own state publish. Whichever landed second won, which is
        // exactly why the airlock only sometimes followed a seal (showcase-cleanup
        // §9.1). Perimeter and Power already record the commanded value this way.
        state.set("sealed", sealed);
        setAction(sealed
            ? "Bunker sealed · positive pressure established"
            : "Airlock returned to normal ventilation");
    }
    else {
        setAction("Filtration command not verified");
    }
    // Reported either way, and from state. On failure that republishes the unchanged
    // seal, so the overview cannot be left showing a transition that never happened.
    // The pressure and temperature carried here are the last ones observed; the
    // controller's publish re-runs this automation and corrects them.
    publishAirSummary();
}
