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
    const result = await devices.action(fx.id, "command", { payload: { scene, smoke } }, {
        tier: "observed",
        deviceId: fx.id,
        condition: { field: "scene", op: "eq", value: scene },
        timeoutMs: 5000,
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
}
export async function toggleHaze() {
    const smoke = Boolean(state.get("smoke"));
    await setRoomScene(String(state.get("scene") || "puzzle"), !smoke, smoke ? "Haze cleared by operator" : "Haze added by operator");
}
