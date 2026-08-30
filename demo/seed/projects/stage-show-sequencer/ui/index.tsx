// Show Control — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import ShowControlDashboard from "./ShowControlDashboard";

export default function ShowControl(aeolus: CustomComponentProps) {
  const model = {
    scene: aeolus.read("scene"),
    master: aeolus.read("master"),
    fixtures: aeolus.read("fixtures"),
    cueNumber: aeolus.read("cueNumber"),
    pending: aeolus.read("pending"),
    pendingFx: aeolus.read("pendingFx"),
    fxActive: aeolus.read("fxActive"),
    effect: aeolus.read("effect"),
    haze: aeolus.read("haze"),
    safe: aeolus.read("safe"),
    estop: aeolus.read("estop"),
    loopHealthy: aeolus.read("loopHealthy"),
    pyroArmed: aeolus.read("pyroArmed"),
    exclusionClear: aeolus.read("exclusionClear"),
    waterReady: aeolus.read("waterReady"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    runCue: (payload: unknown) => aeolus.fire("run-cue", payload),
    stopFx: () => aeolus.fire("stop-fx"),
    fireEffect: (payload: unknown) => aeolus.fire("fire-effect", payload),
    simulateTrip: () => aeolus.fire("simulate-trip"),
    resetSafety: () => aeolus.fire("reset-safety"),
  };

  return <ShowControlDashboard model={model} actions={actions} />;
}
