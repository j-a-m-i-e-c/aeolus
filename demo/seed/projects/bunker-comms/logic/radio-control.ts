// Bunker radio implementation. logic/index.ts owns the event flow.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export async function transmitCheckIn() {
    const radio = byTopic("switch/bunker/radio/state");
    if (!radio)
        return;
    state.set("pending", true);
    const result = await devices.action(radio.id, "command", { payload: { tx: true } }, {
        tier: "observed",
        deviceId: radio.id,
        condition: { field: "tx", op: "eq", value: true },
        timeoutMs: 5000,
    });
    state.set("pending", false);
    if (result.success) {
        state.set("txUntil", Date.now() + 1200);
        setAction("146.52 MHz check-in transmitted");
    }
    else {
        setAction("Radio transmission not verified");
    }
}
export function handleCommsDemoEvent(event: string | undefined) {
    if (event !== "simulate-contact") return;
    events.emit("bunker/sim/radio-contact", {});
    setAction("DEMO · injecting a weak external VHF transmission");
}
export function projectRadioState() {
    const radio = byTopic("sensor/bunker/radio/rx");
    const observed = radio && radio.state ? radio.state : {};
    const frequency = Number(observed.frequency ?? 146.52);
    const signal = String(observed.signal || "quiet");
    const message = String(observed.message || "");
    const contactsToday = Number(observed.contactsToday ?? 3);
    state.set("frequency", frequency);
    state.set("signal", signal);
    state.set("message", message);
    state.set("contactsToday", contactsToday);
    if (signal !== "quiet")
        setAction("Weak VHF contact received");
    events.emit("bunker/summary/comms", { frequency, signal, contactsToday });
}
