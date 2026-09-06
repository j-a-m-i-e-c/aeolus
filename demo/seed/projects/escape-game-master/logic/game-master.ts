// Escape-room Game Master implementation. logic/index.ts shows the session flow.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function initialiseGameSession() {
    if (state.get("remaining") !== undefined)
        return;
    state.set("remaining", 2700);
    state.set("timerStartedAt", Date.now());
    state.set("paused", false);
    state.set("p1", false);
    state.set("p2", false);
    state.set("p3", false);
    state.set("p4", false);
    state.set("solved", 0);
    state.set("currentRoom", "Library");
    state.set("hintsSent", 0);
    state.set("lastHint", "No hint sent yet.");
    state.set("lastHintId", 0);
    state.set("hintRoom", "Library");
    state.set("exitUnlocked", false);
    state.set("requestedLook", "puzzle");
    state.set("intercomTx", false);
    state.set("intercomRoom", "Library");
    state.set("lookRequestedAt", 0);
}
/**
 * Read the room controller's observed scene.
 *
 * Game Master *requests* a look; Room Systems owns and commands the controller. This
 * only reads it, which is what lets the console tell a request it has sent apart
 * from the scene the room is physically in — without either automation's UI knowing
 * the other exists. The request goes out as a domain event and the confirmation
 * comes back as physical device state, which is the same evidence a visitor sees on
 * the Room Systems pane.
 */
export function projectRoomLook() {
    const fx = byTopic("switch/escape/fx/state");
    const applied = String(fx && fx.state && fx.state.scene || "");
    state.set("appliedLook", applied || "puzzle");
    state.set("roomHaze", Boolean(fx && fx.state && fx.state.smoke));
}
const HINTS: Record<string, string[]> = {
    Library: [
        "The book spines are not ordered randomly.",
        "Try reading the coloured symbols from darkest to lightest.",
        "Use the year stamped inside the atlas as the rotary code.",
    ],
    "Laser Hall": [
        "The beams react to sequence, not speed.",
        "Watch which receiver flashes after each correct beam.",
        "Cross blue → amber → red, then hold the floor plate for three seconds.",
    ],
    Observatory: [
        "The stars above the desk form a pattern seen elsewhere in the room.",
        "Rotate the brass sky wheel until Orion aligns with the window marks.",
        "Set the wheel to 21:40 and press the illuminated southern star.",
    ],
    Vault: [
        "The scale cares about balance, not total weight.",
        "One brass weight is hollow; compare the engraved symbols.",
        "Place moon + key on the left and hourglass on the right.",
    ],
};
function hintText(room: string, level: number) {
    const hints = HINTS[room] || HINTS.Library;
    return hints[Math.max(0, Math.min(2, level - 1))];
}
async function setExit(unlocked: boolean) {
    const exit = byTopic("switch/escape/exit/state");
    if (!exit)
        return;
    const result = await devices.action(exit.id, "command", { payload: { locked: !unlocked } }, {
        tier: "observed",
        deviceId: exit.id,
        condition: { field: "locked", op: "eq", value: !unlocked },
        timeoutMs: 5000,
    });
    if (result.success) {
        state.set("exitUnlocked", unlocked);
        setAction(unlocked ? "All puzzles solved · exit maglock released" : "Exit maglock secured");
    }
    else {
        setAction("Exit command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
}
async function sendHint(level: number) {
    const screen = byTopic("switch/escape/hint-screen/state");
    if (!screen)
        return;
    const room = String(state.get("currentRoom") || "Library");
    const text = hintText(room, level);
    const hintId = Number(state.get("lastHintId") || 0) + 1;
    state.set("pendingHint", true);
    const result = await devices.action(screen.id, "command", { payload: { message: text, room, hintId } }, { tier: "acknowledged", deviceId: screen.id, timeoutMs: 5000 });
    state.set("pendingHint", false);
    if (result.success) {
        state.set("hintsSent", Number(state.get("hintsSent") || 0) + 1);
        state.set("lastHint", text);
        state.set("lastHintId", hintId);
        state.set("hintRoom", room);
        state.set("hintLevel", level);
        setAction("Hint #" + hintId + " delivered to " + room);
    }
    else {
        setAction("Hint delivery not acknowledged");
    }
}
async function setIntercom(tx: boolean) {
    const intercom = byTopic("switch/escape/intercom/state");
    if (!intercom)
        return;
    const room = String(state.get("currentRoom") || "Library");
    state.set("intercomPending", true);
    const result = await devices.action(intercom.id, "command", { payload: { tx, room } }, {
        tier: "observed",
        deviceId: intercom.id,
        condition: { field: "tx", op: "eq", value: tx },
        timeoutMs: 5000,
    });
    state.set("intercomPending", false);
    if (result.success) {
        state.set("intercomTx", tx);
        state.set("intercomRoom", room);
        setAction(tx ? "Game Master live to " + room : "Game Master intercom released");
    }
    else {
        setAction("Intercom command not verified");
    }
}
export async function handleGameMasterAction(event: string | undefined, payload: Record<string, unknown>) {
    let remaining = Number(payload.remaining);
    if (!Number.isFinite(remaining))
        remaining = Number(state.get("remaining") || 2700);
    if (event === "add-time" || event === "sub-time" || event === "pause") {
        if (event === "add-time")
            remaining = Math.min(7200, remaining + 60);
        if (event === "sub-time")
            remaining = Math.max(0, remaining - 60);
        state.set("remaining", remaining);
        state.set("timerStartedAt", Date.now());
        if (event === "pause")
            state.set("paused", !Boolean(state.get("paused")));
        setAction(event === "pause"
            ? (Boolean(state.get("paused")) ? "Game timer paused" : "Game timer resumed")
            : (event === "add-time" ? "Game master added one minute" : "Game master removed one minute"));
        return;
    }
    if (event === "hint-nudge")
        await sendHint(1);
    else if (event === "hint-strong")
        await sendHint(2);
    else if (event === "hint-solve")
        await sendHint(3);
    else if (event === "look-calm" || event === "look-puzzle" || event === "look-tension") {
        const look = String(event.split("-").pop());
        // The request is recorded and published straight away. Whether the room is
        // physically in that state is a separate question, answered by the
        // controller's own telemetry rather than by this automation assuming it.
        state.set("requestedLook", look);
        state.set("lookRequestedAt", Date.now());
        events.emit("escape/game/look-request", { scene: look });
        setAction("Requested " + look + " room look · awaiting room systems");
    }
    else if (event === "talk-start")
        await setIntercom(true);
    else if (event === "talk-stop")
        await setIntercom(false);
}
export function projectPuzzleStatus(payload: Record<string, unknown>) {
    ["p1", "p2", "p3", "p4"].forEach((key) => state.set(key, Boolean(payload[key])));
    state.set("solved", Number(payload.solved || 0));
    state.set("currentRoom", String(payload.currentRoom || "Library"));
    if (Array.isArray(payload.solveSeconds))
        state.set("solveSeconds", payload.solveSeconds);
    if (Array.isArray(payload.attempts))
        state.set("attempts", payload.attempts);
    return Boolean(payload.complete);
}
export async function reconcileExitForCompletion(complete: boolean) {
    if (complete && !Boolean(state.get("exitUnlocked"))) {
        await setExit(true);
        state.set("requestedLook", "victory");
        state.set("lookRequestedAt", Date.now());
        events.emit("escape/game/completed", { scene: "victory", solved: 4 });
    }
    else if (!complete && Boolean(state.get("exitUnlocked"))) {
        await setExit(false);
        state.set("requestedLook", "puzzle");
        state.set("lookRequestedAt", Date.now());
        events.emit("escape/game/look-request", { scene: "puzzle" });
    }
}
