// Sugar-glider den telemetry and thermal alert transitions.
function byTopic(wanted: string) {
    return devices.list().find((device) => device.topic === wanted);
}
function numberAt(device: any, field: string, fallback: number) {
    const value = Number(device && device.state && device.state[field]);
    return isNaN(value) ? fallback : value;
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function handleDenOperatorEvent(event: string | undefined) {
    if (event === "acknowledge-alert") {
        state.set("acknowledged", true);
        setAction("Den thermal alert acknowledged");
    }
    else if (event === "simulate-visit") {
        events.emit("wildlife/sim/nest-visit", {});
        setAction("Injecting a sugar glider return to the den");
    }
    else if (event === "simulate-heat") {
        events.emit("wildlife/sim/nest-heat", {});
        setAction("Injecting a hot afternoon at the den box");
    }
    else if (event === "reset-nest") {
        events.emit("wildlife/sim/nest-reset", {});
        state.set("acknowledged", false);
        setAction("Resetting den conditions");
    }
}
export function projectDenTelemetry() {
    const den = byTopic("sensor/wildlife/nest");
    const observed = den && den.state ? den.state : {};
    const temp = numberAt(den, "temp", 31.8);
    const humidity = numberAt(den, "humidity", 61);
    const joeys = numberAt(den, "joeys", 2);
    const thermalState = String(observed.thermalState || "normal");
    const thermalAlert = thermalState === "high" || temp >= 37.5;
    const wasAlert = Boolean(state.get("thermalAlert"));
    state.set("temp", temp);
    state.set("humidity", humidity);
    state.set("occupied", observed.occupied !== false);
    state.set("adultPresent", Boolean(observed.adultPresent));
    state.set("adultGliders", numberAt(den, "adultGliders", 2));
    state.set("joeys", joeys);
    state.set("visits", numberAt(den, "visitsToday", 7));
    state.set("thermalState", thermalState);
    state.set("thermalAlert", thermalAlert);
    if (!wasAlert && thermalAlert) {
        state.set("acknowledged", false);
        setAction("Sugar glider den thermal alert · " + temp.toFixed(1) + "°C");
        events.emit("wildlife/den/thermal-alert", { temp, humidity, joeys });
    }
    else if (wasAlert && !thermalAlert) {
        setAction("Den box returned to normal thermal range");
    }
}
