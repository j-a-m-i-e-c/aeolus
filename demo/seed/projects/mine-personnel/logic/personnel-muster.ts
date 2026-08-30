// Personnel tracking and verified muster control.
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
    const result = await devices.action(controller.id, "command", { payload: { active } }, {
        tier: "observed",
        deviceId: controller.id,
        condition: { field: "active", op: "eq", value: active },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
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
