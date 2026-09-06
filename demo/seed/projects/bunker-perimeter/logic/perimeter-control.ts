// Perimeter-security implementation. logic/index.ts keeps AUTO policy visible.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function projectFloodlightState() {
    if (state.get("autoLights") === undefined)
        state.set("autoLights", true);
    const floodlights = byTopic("switch/bunker/floodlights/state");
    const previous = state.get("lightsOn");
    state.set("lightsAvailable", Boolean(floodlights));
    if (floodlights)
        state.set("lightsOn", Boolean(floodlights.state && floodlights.state.on));
    else if (state.get("lightsOn") === undefined)
        state.set("lightsOn", false);
    // `on` is the switch; brightness is the light. A fixture that has accepted the
    // command is not yet a lit approach, and what turns contacts back is the light.
    const brightness = Number(floodlights && floodlights.state && floodlights.state.brightness);
    state.set("floodlightPct", isNaN(brightness) ? 0 : brightness);
    const observed = Boolean(state.get("lightsOn"));
    return {
        observed,
        drifted: previous === undefined || Boolean(previous) !== observed,
    };
}
export function publishPerimeterSummary() {
    events.emit("bunker/summary/perimeter", {
        contacts: Number(state.get("contacts") || 0),
        sector: String(state.get("sector") || "east"),
        classification: String(state.get("classification") || "none"),
        lightsOn: Boolean(state.get("lightsOn")),
        autoLights: Boolean(state.get("autoLights")),
        // The hero draws the surface scene, so it needs where things are, not just
        // how many there are.
        rangeM: Number(state.get("rangeM") || 140),
        movement: String(state.get("movement") || "clear"),
        ambientContacts: Number(state.get("ambientContacts") || 2),
        trackRangeM: Number(state.get("trackRangeM") || 140),
        detectRangeM: Number(state.get("detectRangeM") || 60),
        fenceRangeM: Number(state.get("fenceRangeM") || 18),
        floodlightPct: Number(state.get("floodlightPct") || 0),
    });
}
export async function setFloodlights(on: boolean, reason: string) {
    const controller = byTopic("switch/bunker/floodlights/state");
    if (!controller) {
        setAction("Floodlight controller not reachable · no command issued");
        return false;
    }
    state.set("pending", true);
    const result = await devices.action(controller.id, "command", { payload: { on } }, {
        tier: "observed",
        deviceId: controller.id,
        condition: { field: "on", op: "eq", value: on },
        timeoutMs: 5000,
    });
    state.set("pending", false);
    if (result && result.success) {
        state.set("lightsOn", on);
        setAction(reason);
        return true;
    }
    setAction("Floodlight command not verified: " + String((result && (result.error || result.lifecycleState)) || "no result from the command boundary"));
    return false;
}
export async function handlePerimeterOperatorEvent(event: string | undefined, observed: boolean) {
    if (event === "toggle-lights") {
        const wasAuto = Boolean(state.get("autoLights"));
        state.set("autoLights", false);
        if (!await setFloodlights(!observed, "Manual floodlight override · AUTO disabled")) {
            state.set("autoLights", wasAuto);
        }
    }
    else if (event === "return-auto") {
        state.set("autoLights", true);
        const shouldBeOn = Number(state.get("contacts") || 0) > 0;
        if (observed !== shouldBeOn) {
            await setFloodlights(shouldBeOn, "Perimeter floodlights returned to AUTO");
        }
        else {
            setAction("Perimeter floodlights returned to AUTO");
        }
    }
    else if (event === "simulate-contacts") {
        events.emit("bunker/sim/shambling-contacts", {});
        setAction("Injecting shambling contacts at the perimeter");
    }
    else if (event === "clear-perimeter") {
        events.emit("bunker/sim/perimeter-clear", {});
        setAction("Clearing simulated perimeter contacts");
    }
    publishPerimeterSummary();
}
function numberAt(source: Record<string, unknown>, field: string, fallback: number) {
    const value = Number(source[field]);
    return isNaN(value) ? fallback : value;
}
export function projectPerimeterTelemetry() {
    const sensor = byTopic("sensor/bunker/perimeter");
    const observed = sensor && sensor.state ? sensor.state : {};
    const contacts = Number(observed.contacts || 0);
    const sector = String(observed.sector || "east");
    const movement = String(observed.movement || "clear");
    state.set("contacts", contacts);
    state.set("sector", sector);
    state.set("classification", String(observed.classification || "none"));
    // Range and movement are physical state the classifier owns. Projecting them
    // lets the pane draw where things actually are on the approach instead of making
    // a contact count appear and disappear on the fence line.
    state.set("rangeM", numberAt(observed, "rangeM", 140));
    state.set("closingMps", numberAt(observed, "closingMps", 0));
    state.set("movement", movement);
    state.set("ambientContacts", numberAt(observed, "ambientContacts", 2));
    state.set("trackRangeM", numberAt(observed, "trackRangeM", 140));
    state.set("detectRangeM", numberAt(observed, "detectRangeM", 60));
    state.set("fenceRangeM", numberAt(observed, "fenceRangeM", 18));
    return { contacts, sector, movement };
}
export function describePerimeter(contacts: number, sector: string, movement: string) {
    if (contacts > 0) {
        const range = Math.round(Number(state.get("rangeM") || 0));
        setAction(contacts + " perimeter contact" + (contacts === 1 ? "" : "s")
            + " · " + sector + " sector · " + range + " m"
            + (movement === "withdrawing" ? " and opening" : movement === "at-fence" ? " at the fence" : ""));
        return;
    }
    setAction(movement === "withdrawing"
        ? "Contacts withdrawing past the treeline."
        : "Perimeter clear. Probably just possums.");
}
