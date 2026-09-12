// Wildlife Detection — UI composition entry point.
// At a glance: trail-camera telemetry becomes classified native/predator detections and shared domain events.

import WildlifeDetectionDashboard from "./WildlifeDetectionDashboard";

import { createDemoActions } from "./demo-actions";

export default function WildlifeDetection(aeolus: CustomComponentProps) {
  const model = {
    species: aeolus.read("species"),
    label: aeolus.read("label"),
    category: aeolus.read("category"),
    confidence: aeolus.read("confidence"),
    distanceM: aeolus.read("distanceM"),
    movement: aeolus.read("movement"),
    speedMps: aeolus.read("speedMps"),
    detectedAt: aeolus.read("detectedAt"),
    // Read-only view of the deterrent Predator Response owns, so the hero pane can show
    // the consequence of a classification rather than stopping at the domain event.
    deterrentActive: aeolus.read("deterrentActive"),
    deterrentCommandRpm: aeolus.read("deterrentCommandRpm"),
    deterrentMeasuredRpm: aeolus.read("deterrentMeasuredRpm"),
    battery: aeolus.read("battery"),
    solarW: aeolus.read("solarW"),
    fps: aeolus.read("fps"),
    inferenceMs: aeolus.read("inferenceMs"),
    detectionsToday: aeolus.read("detectionsToday"),
    nativeToday: aeolus.read("nativeToday"),
    predatorsToday: aeolus.read("predatorsToday"),
    denOccupied: aeolus.read("denOccupied"),
    denAdultPresent: aeolus.read("denAdultPresent"),
    denJoeys: aeolus.read("denJoeys"),
    denTemp: aeolus.read("denTemp"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    ...createDemoActions(aeolus),
  };

  return <WildlifeDetectionDashboard model={model} actions={actions} />;
}
