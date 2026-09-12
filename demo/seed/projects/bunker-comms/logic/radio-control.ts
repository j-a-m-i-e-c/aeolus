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
    // Acknowledgement is the honest ceiling: nothing here hears the transmission.
    //
    // The radio sets `tx` as it accepts and drops it again on a timer, so observing
    // `tx` is the command read back. Proving a transmission actually went out would
    // need a remote station confirming receipt, which this site has no way to measure.
    const result = await devices.action(radio.id, "command", { payload: { tx: true } }, {
        tier: "acknowledged",
        timeoutMs: 5000,
        evidence: {
            intent: "Transmit 146.52 MHz check-in",
        },
    });
    state.set("pending", false);
    // Keep the proof, not just the verdict. Nothing on this site can hear the
    // transmission, so the receipt is what stops "check-in transmitted" reading as a
    // confirmed contact: the observation stage is marked unavailable.
    state.set("lastCommand", devices.commandEvidence(result.commandId));
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
    // The transmitter is a separate device from the receiver, so TX is read from it
    // rather than inferred from a countdown this automation kept for itself.
    const transmitter = byTopic("switch/bunker/radio/state");
    const transmitting = Boolean(transmitter && transmitter.state && transmitter.state.tx);
    state.set("transmitting", transmitting);
    events.emit("bunker/summary/comms", { frequency, signal, contactsToday, transmitting });
}
