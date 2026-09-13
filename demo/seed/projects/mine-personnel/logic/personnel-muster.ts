// Personnel tracking and verified muster control.
/**
 * How many people a complete muster has to account for.
 *
 * Read from the tracking network rather than written down: it is however many were
 * underground when the muster was called. This was a hard-coded 14, which matched the
 * fixture and nothing else — change the crew and the observation waits for a refuge
 * occupancy that can never arrive, so every muster times out and reports unverified while
 * working perfectly.
 *
 * Zero is a real answer and not a target. Waiting for `refuge >= 0` would be satisfied
 * the instant it was asked, which is the purest form of the thing this pass exists to
 * remove: a proof that cannot fail. A muster with nobody underground is refused instead.
 */
function crewUnderground(): number {
    const counted = Number(state.get("underground"));
    return isNaN(counted) || counted < 0 ? 0 : counted;
}

function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/**
 * Report the crew's distribution to whoever is aggregating it.
 *
 * Emitted from this automation's own state rather than from a device read, so a caller
 * that has just commanded a muster reports the muster it commanded. See commandMuster
 * for why reading the devices there would report the crew still at their working levels.
 */
export function publishPersonnelSummary() {
    events.emit("mine/summary/personnel", {
        underground: Number(state.get("underground") || 0),
        l1: Number(state.get("l1") || 0),
        l2: Number(state.get("l2") || 0),
        l3: Number(state.get("l3") || 0),
        refuge: Number(state.get("refuge") || 0),
        unaccounted: Number(state.get("unaccounted") || 0),
        musterState: String(state.get("musterState") || "normal"),
        alarmActive: Boolean(state.get("alarmActive")),
    });
}
/**
 * Project the personnel tracking network and the muster controller.
 *
 * Correct wherever this path runs because a device published — the snapshot is then the
 * state that woke the automation. Not correct straight after issuing a command.
 */
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
    publishPersonnelSummary();
}
export async function commandMuster(active: boolean) {
    const controller = byTopic("switch/mine/muster/state");
    if (!controller) {
        setAction("Muster controller unavailable");
        return;
    }
    // Checked before the spinner goes up, so refusing cannot leave the pane waiting.
    const crew = crewUnderground();
    if (active && crew === 0) {
        setAction("Nobody underground · no muster to verify");
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
            ? { field: "refuge", op: "gte", value: crew }
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
        // Record the muster we commanded. This used to call projectPersonnelState(), which
        // re-reads devices.list() — and that list is a snapshot taken once at the start of
        // the execution, so it still described the crew as they were BEFORE the muster. A
        // verified muster therefore projected the refuge as it had been at the alarm,
        // typically 4 of 14 with ten unaccounted, and emitted that to the mine overview.
        // Ten missing people beside a receipt saying everyone was accounted for is the
        // worst version of this bug on the showcase.
        //
        // Only the alarm, because the alarm is what this command asserted. The headcounts
        // and the muster's own stage — mustering, then complete — are the tracking
        // network's to report, and the publish that satisfied the observation is itself
        // the one that re-runs this automation with them.
        state.set("musterActive", active);
        state.set("alarmActive", active);
        setAction(active ? "Muster alarm verified · tracking personnel to refuge" : "Muster cleared");
    }
    // Reported either way, and from state. On failure that republishes the unchanged
    // muster, so the overview cannot be left showing an evacuation that never started.
    publishPersonnelSummary();
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
