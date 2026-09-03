// Sugar-glider den telemetry, thermal alerting and verified den-box cooling.
//
// The den box has a solar-powered cooling fan. An alert is not something an
// operator dismisses; it is something Aeolus acts on and then proves it acted on.
// The fan's tachometer is the proof, because a controller that accepted 1800 rpm
// is not the same thing as a fan moving air over two joeys at 38°C.
const DEN_FAN_TOPIC = "switch/wildlife/den-fan/state";
/** Speed the fan is asked to hold, in rpm. */
const DEN_FAN_TARGET_RPM = 1800;
/** Tachometer reading that proves the impeller is genuinely moving air. */
const DEN_FAN_VERIFIED_RPM = 1500;
/** Reading that proves the fan has actually stopped, in rpm. */
const DEN_FAN_STOPPED_RPM = 100;
/** Box temperature at or above which the colony is at risk, in °C. */
const DEN_ALERT_TEMP = 37.5;
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
export function initialiseDenPolicy() {
    if (state.get("autoCooling") === undefined)
        state.set("autoCooling", true);
    if (state.get("coolingOutcome") === undefined)
        state.set("coolingOutcome", "Den box within range · fan idle");
}
/**
 * Project the fan and power readings into this automation's own state. The pane
 * has no device access, so the commanded and measured speeds only reach the
 * operator through here — and the gap between them is the whole point.
 */
export function projectFanReadings() {
    const fan = byTopic(DEN_FAN_TOPIC);
    const power = byTopic("sensor/wildlife/site-power");
    const observed = fan && fan.state ? fan.state : {};
    state.set("fanActive", Boolean(observed.active));
    state.set("fanCommandRpm", numberAt(fan, "commandRpm", 0));
    state.set("fanMeasuredRpm", numberAt(fan, "measuredRpm", 0));
    state.set("fanRunsToday", numberAt(fan, "runsToday", 4));
    state.set("fanTargetRpm", DEN_FAN_TARGET_RPM);
    state.set("solarW", numberAt(power, "solarW", 41));
    state.set("batteryPct", numberAt(power, "battery", 87));
}
export async function handleDenOperatorEvent(event: string | undefined) {
    if (event === "toggle-auto-cooling") {
        const next = !Boolean(state.get("autoCooling"));
        state.set("autoCooling", next);
        setAction(next ? "Automatic den cooling armed" : "Automatic den cooling disabled");
        if (!next)
            await stopDenCooling("Operator disabled automatic cooling");
    }
    else if (event === "stop-cooling") {
        await stopDenCooling("Operator stopped den cooling");
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
        // The stimulus restores the box and stands the fan down together, so the
        // scenario cannot be left cooling a den that is no longer hot.
        events.emit("wildlife/sim/nest-reset", {});
        state.set("coolingOutcome", "Den box within range · fan idle");
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
    const thermalAlert = thermalState === "high" || temp >= DEN_ALERT_TEMP;
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
        setAction("Sugar glider den thermal alert · " + temp.toFixed(1) + "°C");
        events.emit("wildlife/den/thermal-alert", { temp, humidity, joeys });
    }
    else if (wasAlert && !thermalAlert) {
        setAction("Den box returned to normal thermal range");
    }
    return { thermalAlert, thermalState, temp };
}
/**
 * Cool the box while it is out of range and stop once it is genuinely back.
 *
 * The start and stop thresholds deliberately differ: cooling begins at the alert
 * temperature but does not stop until the box reads "normal", so the fan is not
 * switched off the instant the reading dips below the alarm line.
 */
export async function applyThermalPolicy(reading: {
    thermalAlert: boolean;
    thermalState: string;
    temp: number;
}) {
    if (!Boolean(state.get("autoCooling")))
        return;
    if (Boolean(state.get("commandPending")))
        return;
    const fan = byTopic(DEN_FAN_TOPIC);
    if (!fan) {
        state.set("coolingOutcome", "Den fan unavailable");
        return;
    }
    const running = Boolean(fan.state && fan.state.active);
    if (reading.thermalAlert && !running) {
        await startDenCooling(reading.temp);
    }
    else if (running && reading.thermalState === "normal") {
        await stopDenCooling("Den box back in range · cooling stopped");
    }
}
async function startDenCooling(temp: number) {
    const fan = byTopic(DEN_FAN_TOPIC);
    if (!fan)
        return;
    state.set("commandPending", true);
    state.set("coolingOutcome", "Requesting " + DEN_FAN_TARGET_RPM + " rpm at the den box");
    setAction("Den box at " + temp.toFixed(1) + "°C · requesting cooling");
    // Verified by the tachometer, not by the fan controller's own `active` flag.
    const result = await devices.action(fan.id, "command", { payload: { active: true, rpm: DEN_FAN_TARGET_RPM } }, {
        tier: "observed",
        deviceId: fan.id,
        condition: { field: "measuredRpm", op: "gte", value: DEN_FAN_VERIFIED_RPM },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
    projectFanReadings();
    if (result.success) {
        state.set("coolingVerifiedAt", Date.now());
        state.set("coolingOutcome", "Cooling VERIFIED · fan measured at speed");
        setAction("Den fan verified moving air at " + Number(state.get("fanMeasuredRpm") || 0) + " rpm");
    }
    else {
        state.set("coolingOutcome", "Cooling not verified");
        setAction("Den cooling not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
}
export async function stopDenCooling(reason: string) {
    const fan = byTopic(DEN_FAN_TOPIC);
    if (!fan || !(fan.state && fan.state.active))
        return;
    state.set("commandPending", true);
    // A stop is proven by the impeller winding down, so the observation is the
    // tachometer falling rather than the controller clearing its own flag.
    const result = await devices.action(fan.id, "command", { payload: { active: false, rpm: 0 } }, {
        tier: "observed",
        deviceId: fan.id,
        condition: { field: "measuredRpm", op: "lte", value: DEN_FAN_STOPPED_RPM },
        timeoutMs: 5000,
    });
    state.set("commandPending", false);
    projectFanReadings();
    if (result.success) {
        state.set("coolingOutcome", reason);
        setAction(reason);
    }
    else {
        state.set("coolingOutcome", "Den fan stop not verified");
        setAction("Den fan stop not verified: " + String(result.error || result.lifecycleState || "unknown"));
    }
}
