// Edge-wildlife telemetry projection and classification publishing.
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
export function handleWildlifeDemoEvent(event: string | undefined) {
    if (event === "simulate-native")
        events.emit("wildlife/sim/native-detection", {});
    else if (event === "simulate-fox")
        events.emit("wildlife/sim/fox-detection", {});
    else if (event === "simulate-cat")
        events.emit("wildlife/sim/cat-detection", {});
    else if (event === "reset-wildlife") {
        events.emit("wildlife/sim/reset", {});
        setAction("Resetting edge station to dusk conditions");
    }
}
export function projectWildlifeStation() {
    const camera = byTopic("sensor/wildlife/camera");
    const detection = byTopic("sensor/wildlife/detection");
    const power = byTopic("sensor/wildlife/site-power");
    const den = byTopic("sensor/wildlife/nest");
    const detectionState = detection && detection.state ? detection.state : {};
    const cameraState = camera && camera.state ? camera.state : {};
    const nestState = den && den.state ? den.state : {};
    state.set("cameraOnline", cameraState.online !== false);
    state.set("accelerator", String(cameraState.accelerator || "Hailo-8L"));
    state.set("fps", numberAt(camera, "fps", 30));
    state.set("inferenceMs", numberAt(camera, "inferenceMs", 17));
    state.set("framesToday", numberAt(camera, "framesToday", 18432));
    state.set("species", String(detectionState.species || "ringtail-possum"));
    state.set("label", String(detectionState.label || "Ringtail Possum"));
    state.set("category", String(detectionState.category || "native"));
    state.set("confidence", numberAt(detection, "confidence", 0.91));
    // Distance, speed and movement are physical state the simulator owns. The pane
    // draws the animal where the camera says it is instead of animating a private
    // copy from how long ago the detection fired.
    state.set("distanceM", numberAt(detection, "distanceM", 7.2));
    state.set("speedMps", numberAt(detection, "speedMps", 0));
    state.set("movement", String(detectionState.movement || "clear"));
    state.set("direction", String(detectionState.direction || "east"));
    state.set("detectedAt", numberAt(detection, "ts", Date.now() - 16000));
    state.set("battery", numberAt(power, "battery", 87));
    state.set("solarW", numberAt(power, "solarW", 41));
    state.set("nodeW", numberAt(power, "nodeW", 8.4));
    state.set("denOccupied", nestState.occupied !== false);
    state.set("denAdultPresent", Boolean(nestState.adultPresent));
    state.set("denJoeys", numberAt(den, "joeys", 2));
    state.set("denTemp", numberAt(den, "temp", 31.8));
    return { detection, detectionState };
}
export function publishNewClassification(projected: ReturnType<typeof projectWildlifeStation>) {
    const eventId = String(projected.detectionState.eventId || "");
    const previous = String(state.get("lastEventId") || "");
    if (!eventId || eventId === previous)
        return;
    state.set("lastEventId", eventId);
    const category = String(projected.detectionState.category || "unknown");
    const label = String(projected.detectionState.label || "Unknown");
    const actionLabel = String(projected.detectionState.label || "Wildlife");
    const confidence = numberAt(projected.detection, "confidence", 0);
    const total = Number(state.get("detectionsToday") || 47) + 1;
    let nativeCount = Number(state.get("nativeToday") || 39);
    let predatorCount = Number(state.get("predatorsToday") || 8);
    if (category === "native")
        nativeCount += 1;
    else if (category === "predator")
        predatorCount += 1;
    state.set("detectionsToday", total);
    state.set("nativeToday", nativeCount);
    state.set("predatorsToday", predatorCount);
    setAction(actionLabel + " classified locally · " + Math.round(confidence * 100) + "% confidence");
    events.emit("wildlife/detection/classified", {
        eventId,
        species: String(projected.detectionState.species || "unknown"),
        label,
        category,
        confidence,
        distanceM: numberAt(projected.detection, "distanceM", 0),
        ts: numberAt(projected.detection, "ts", Date.now()),
    });
    try {
        if (db)
            db.write("wildlife-events", { eventId, species: label, category, confidence });
    }
    catch (error) {
        // Demo history is best-effort; classification still fans out via events.
    }
}
