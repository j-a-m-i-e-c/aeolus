// Wildlife Detection — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import WildlifeDetectionDashboard from "./WildlifeDetectionDashboard";

export default function WildlifeDetection(aeolus: CustomComponentProps) {
  const model = {
    species: aeolus.read("species"),
    label: aeolus.read("label"),
    category: aeolus.read("category"),
    confidence: aeolus.read("confidence"),
    distanceM: aeolus.read("distanceM"),
    detectedAt: aeolus.read("detectedAt"),
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
    simulateNative: () => aeolus.fire("simulate-native"),
    simulateFox: () => aeolus.fire("simulate-fox"),
    simulateCat: () => aeolus.fire("simulate-cat"),
    resetWildlife: () => aeolus.fire("reset-wildlife"),
  };

  return <WildlifeDetectionDashboard model={model} actions={actions} />;
}
