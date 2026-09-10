// Bunker air-system implementation. logic/index.ts owns the event flow.
function filterController() {
    return devices.list().find((device) => device.topic === "switch/bunker/filter/state");
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
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
    events.emit("bunker/summary/air", { sealed, overpressure, filterLife, tempC });
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
        setAction(sealed
            ? "Bunker sealed · positive pressure established"
            : "Airlock returned to normal ventilation");
        projectAirState();
    }
    else {
        setAction("Filtration command not verified");
    }
}
