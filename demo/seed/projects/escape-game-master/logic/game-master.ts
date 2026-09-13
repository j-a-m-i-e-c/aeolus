// Escape-room Game Master implementation. logic/index.ts shows the session flow.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
/** A full session, in seconds. */
const SESSION_SECONDS = 2700;
/**
 * Where the session is, as a state machine rather than a boolean.
 *
 *   ready → running ⇄ paused → completed | expired → (start again) → running
 *
 * `paused` used to be the only session flag, which left no way to express "no game has
 * started yet" — so there was no such state and the clock simply ran (showcase-cleanup
 * §8.1).
 */
type GameStatus = "ready" | "running" | "paused" | "completed" | "expired";
function status(): GameStatus {
    return String(state.get("status") || "ready") as GameStatus;
}
/**
 * Seconds left on the clock.
 *
 * Derived the same way here and in the pane: the remaining recorded at the last
 * transition, minus the time elapsed since it — and only while the clock is running.
 * READY, PAUSED, COMPLETED and EXPIRED do not tick, so opening the pane cannot consume
 * a session (§8.3).
 */
export function liveRemaining() {
    const remaining = Math.max(0, Number(state.get("remaining") || 0));
    if (status() !== "running")
        return remaining;
    const startedAt = Number(state.get("timerStartedAt") || 0);
    if (startedAt <= 0)
        return remaining;
    return Math.max(0, remaining - Math.floor((Date.now() - startedAt) / 1000));
}
/** Freeze the clock where it currently stands and move to `next`. */
function settleClock(next: GameStatus) {
    state.set("remaining", liveRemaining());
    state.set("status", next);
    // Only a running clock has a start instant. Leaving a stale one behind is what
    // would let a paused game keep counting down the moment anything resumed it.
    state.set("timerStartedAt", next === "running" ? Date.now() : 0);
}
export function initialiseGameSession() {
    if (state.get("status") !== undefined)
        return;
    // READY, and the clock is not started. This line used to set `timerStartedAt` to
    // now, so the session began on the automation's first invocation — before anyone had
    // asked for a game, and whether or not a team was in the room.
    state.set("status", "ready");
    state.set("remaining", SESSION_SECONDS);
    state.set("timerStartedAt", 0);
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
    // The boolean the status machine replaced. An install upgraded across §8.1 still has
    // it in persisted state, where nothing reads it and its value contradicts `status` the
    // moment the session moves. Dropped here because this branch runs exactly once per
    // install — the early return above sees to that.
    if (state.get("paused") !== undefined)
        state.delete("paused");
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
/**
 * Reconcile a look request that Room Systems has finished acting on.
 *
 * Publishing the request and reading the controller in the same execution could
 * only ever see the room as it was *before* Room Systems commanded it, and nothing
 * ran this automation again afterwards — so a request stayed PENDING until an
 * unrelated puzzle event happened to re-run it. The observed-completion event is
 * what closes that loop.
 *
 * The event is treated as a trigger, not as truth: the scene still comes from the
 * controller's own telemetry, so a command that failed verification leaves the
 * console showing the request outstanding instead of adopting a look the room never
 * reached.
 */
export function projectRoomLookOutcome(payload: Record<string, unknown>) {
    projectRoomLook();
    const requested = String(payload.requested || state.get("requestedLook") || "puzzle");
    setAction(Boolean(payload.verified)
        ? "Room systems applied the " + requested + " look"
        : "Room did not reach the " + requested + " look · request still outstanding");
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
/**
 * Drive the exit maglock, and report whether it confirmed.
 *
 * The return value is the point: a caller that depends on the door being in a known
 * state has to be able to find out whether it is. startGame is that caller.
 */
async function setExit(unlocked: boolean): Promise<boolean> {
    const exit = byTopic("switch/escape/exit/state");
    if (!exit) {
        setAction("Exit maglock unavailable · the door state cannot be established");
        return false;
    }
    // Acknowledgement is the honest ceiling. A maglock that has accepted "release"
    // republishes `locked` immediately; nothing measures whether the door actually
    // let go. A real installation would use a door sensor or a reed switch, and that
    // is the upgrade path — not a differently-worded read of the same flag.
    const result = await devices.action(exit.id, "command", { payload: { locked: !unlocked } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: unlocked ? "Release exit maglock" : "Secure exit maglock",
        },
    });
    // Keep the proof, not just the verdict. The exit is the one command in this room a
    // team's escape depends on, and the receipt is where the acknowledged ceiling shows:
    // released means the maglock accepted the release, not that the door was seen open.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        state.set("exitUnlocked", unlocked);
        setAction(unlocked ? "All puzzles solved · exit maglock released" : "Exit maglock secured");
        return true;
    }
    setAction("Exit command not verified: " + String(result.error || result.lifecycleState || "unknown"));
    return false;
}
async function sendHint(level: number) {
    const screen = byTopic("switch/escape/hint-screen/state");
    if (!screen)
        return;
    const room = String(state.get("currentRoom") || "Library");
    const text = hintText(room, level);
    const hintId = Number(state.get("lastHintId") || 0) + 1;
    state.set("pendingHint", true);
    // Acknowledgement is the honest ceiling. The screen echoes the message it was
    // given, so observing it is the command read back; whether a player looked up and
    // read the hint is not something this room instruments.
    // No `deviceId` here. It used to name the screen as the observing device, which did
    // nothing — an observation needs a condition, and without one the option is dropped
    // and the capability snapshot is unaffected — while reading like a configured
    // observation to anyone auditing the source.
    const result = await devices.action(screen.id, "command", { payload: { message: text, room, hintId } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Send hint #" + hintId + " to " + room,
        },
    });
    state.set("pendingHint", false);
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        state.set("hintsSent", Number(state.get("hintsSent") || 0) + 1);
        state.set("lastHint", text);
        state.set("lastHintId", hintId);
        state.set("hintRoom", room);
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
    // Acknowledgement is the ceiling: the intercom echoes `tx` on acceptance and
    // nothing in the room measures whether the audio reached the players.
    const result = await devices.action(intercom.id, "command", { payload: { tx, room } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: tx ? "Open intercom to " + room : "Release intercom",
        },
    });
    state.set("intercomPending", false);
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        state.set("intercomTx", tx);
        state.set("intercomRoom", room);
        setAction(tx ? "Game Master live to " + room : "Game Master intercom released");
    }
    else {
        setAction("Intercom command not verified");
    }
}
/**
 * Put the room and the session back to a known start, then run the clock.
 *
 * Every fact a fresh session depends on is established here rather than assumed, which
 * is the difference between starting a game and merely resetting a number (§8.2).
 *
 * The physical room goes back through its own reset path: the props return to their
 * start positions, the puzzle network republishes, Puzzle Progress projects it and
 * reports `escape/observed/puzzles` back here — the same route a real solve takes. This
 * automation does not reach into the puzzle automation's state to do it.
 */
export async function startGame() {
    events.emit("escape/sim/reset", {});

    // Session-specific state this automation owns.
    state.set("hintsSent", 0);
    state.set("lastHint", "No hint sent yet.");
    state.set("lastHintId", 0);
    state.set("hintRoom", "Library");
    state.set("solveSeconds", [0, 0, 0, 0]);
    state.set("attempts", [0, 0, 0, 0]);

    // The room look is requested the way any look is, so Room Systems commands its own
    // controller and its pane agrees with this one about what scene the room is in.
    state.set("requestedLook", "puzzle");
    state.set("lookRequestedAt", Date.now());
    events.emit("escape/game/look-request", { scene: "puzzle" });

    // The exit is secured by a verified command rather than left to the reset's side
    // effect. A session must not begin on the assumption that the door is shut — and
    // that has to mean acting on the answer, not merely asking the question.
    //
    // The result used to be discarded and the clock started regardless, so an
    // unconfirmed maglock produced a RUNNING session carrying the PREVIOUS game's
    // `exitUnlocked` — `true` straight after a team had escaped. The console showed a
    // running game over an open door, and the comment above claimed the opposite.
    const secured = await setExit(false);
    if (!secured) {
        // Deliberately still READY. The room has been reset, which is real and worth
        // keeping, but the session does not start and the clock is untouched, so pressing
        // start again is the whole recovery.
        setAction("Game not started · exit maglock did not confirm it is secured");
        return;
    }

    state.set("remaining", SESSION_SECONDS);
    state.set("status", "running");
    state.set("timerStartedAt", Date.now());
    setAction("Game started · full session on the clock");
}
/**
 * Retire a session whose clock has run out.
 *
 * Checked whenever this automation runs. The pane shows the clock reaching zero as it
 * happens, and this is what makes the recorded session agree the next time anything
 * wakes the automation.
 */
export function reconcileExpiry() {
    if (status() !== "running" || liveRemaining() > 0)
        return;
    settleClock("expired");
    setAction("Session time expired");
}
export async function handleGameMasterAction(event: string | undefined) {
    if (event === "start-game") {
        await startGame();
        return;
    }
    if (event === "pause") {
        // Only a running clock can be paused, and only a paused one resumed. Toggling a
        // boolean could not say that, so pausing a game that had never started used to
        // look like it did something.
        if (status() === "running") {
            settleClock("paused");
            setAction("Game timer paused");
        }
        else if (status() === "paused") {
            settleClock("running");
            setAction("Game timer resumed");
        }
        else {
            setAction("No running game to pause");
        }
        return;
    }
    if (event === "add-time" || event === "sub-time") {
        // Derived here rather than taken from the pane. The remaining seconds used to
        // arrive in the event payload, which made the browser authoritative over the
        // session clock — and on the public demo that is a visitor-supplied number.
        const current = liveRemaining();
        const next = event === "add-time" ? Math.min(7200, current + 60) : Math.max(0, current - 60);
        state.set("remaining", next);
        if (status() === "running")
            state.set("timerStartedAt", Date.now());
        setAction(event === "add-time" ? "Game master added one minute" : "Game master removed one minute");
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
        // The clock stops on the winning second rather than running on behind a
        // finished game, so the time the team escaped in is the time reported.
        if (status() === "running" || status() === "paused")
            settleClock("completed");
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
