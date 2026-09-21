// Escape-room lighting/audio/haze implementation.
type RoomScene = "calm" | "puzzle" | "tension" | "victory";
const SCENES: Record<RoomScene, {
    audio: string;
    lightPct: number;
}> = {
    calm: { audio: "ambient", lightPct: 78 },
    puzzle: { audio: "clockwork", lightPct: 62 },
    tension: { audio: "heartbeat", lightPct: 38 },
    victory: { audio: "fanfare", lightPct: 100 },
};
function controller() {
    return devices.list().find((device) => device.topic === "switch/escape/fx/state");
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function initialiseRoomSystems() {
    if (state.get("scene") === undefined)
        state.set("scene", "puzzle");
    if (state.get("smoke") === undefined)
        state.set("smoke", false);
    if (state.get("audio") === undefined)
        state.set("audio", "clockwork");
    if (state.get("lightPct") === undefined)
        state.set("lightPct", 62);
}
export async function setRoomScene(scene: string, smoke: boolean, label: string) {
    const fx = controller();
    if (!fx)
        return;
    state.set("pending", true);
    state.set("transitioning", true);
    // Acknowledgement is the ceiling here, honestly.
    //
    // The room controller derives `scene`, `audio` and `lightPct` from the command and
    // publishes them in the same tick, so `lightPct == 38` is no more a measurement
    // than `scene == "tension"` — both are the command restated. Nothing in the room
    // measures the light it actually produced. Rather than pick the most
    // physical-sounding echo, this command claims only what the controller confirmed:
    // that it received the cue.
    const result = await devices.action(fx.id, "command", { payload: { scene, smoke } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Apply " + scene + " room look",
        },
    });
    state.set("pending", false);
    state.set("transitioning", false);
    // Keep the proof, not just the verdict: every rung this command reached, with
    // the evidence the runtime recorded for it.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
    if (result.success) {
        const preset = SCENES[scene as RoomScene] || SCENES.puzzle;
        state.set("scene", scene);
        state.set("smoke", smoke);
        state.set("audio", preset.audio);
        state.set("lightPct", preset.lightPct);
        state.set("changedAt", Date.now());
        setAction(label);
    }
    else {
        setAction("Room systems command not verified");
    }
    // The room's current physical condition, for whoever needs to know what the room is
    // actually doing. This automation owns the controller; the requester only reads.
    //
    // Everything here is a condition rather than an occurrence, which is what lets it be
    // Shared State honestly. `scene` and `smoke` are the room the controller is *now* in,
    // never the one that was asked for. `unreached` is the look it was last asked for and
    // could not reach, or null when the room is where it was asked to be — so a request
    // that failed stays legible to the requester for as long as it is still true, without
    // the value having to pretend a retry is a new fact. The attempts themselves are
    // occurrences, and they stay here: `lastAction` and `lastCommand` record each one with
    // its evidence, on the pane belonging to the automation that issued it.
    shared.set("escape-observed", "room", {
        scene: String(state.get("scene") || "puzzle"),
        smoke: Boolean(state.get("smoke")),
        unreached: result.success ? null : scene,
    });
}
export async function toggleHaze() {
    const smoke = Boolean(state.get("smoke"));
    await setRoomScene(String(state.get("scene") || "puzzle"), !smoke, smoke ? "Haze cleared by operator" : "Haze added by operator");
}
