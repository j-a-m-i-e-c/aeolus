// Predator Response — UI composition entry point.
// At a glance: classified predator events drive a humane deterrent with verified physical stop semantics.

import PredatorResponsePanel from "./PredatorResponsePanel";

export default function PredatorResponse(aeolus: CustomComponentProps) {
  // Every value is read from this automation's own projection, never from the
  // device registry: the Wildlife tab exposes no device pane, so a UI that read
  // devices directly would render static defaults and look dead. The Logic
  // projects the deterrent's commanded and measured speed at each step of the
  // command it issues, which is what makes the ACK/OBSERVED gap visible here.
  const model = {
    commandRpm: aeolus.read("commandRpm"),
    measuredRpm: aeolus.read("measuredRpm"),
    deterrentActive: aeolus.read("deterrentActive"),
    predatorDistanceM: aeolus.read("predatorDistanceM"),
    predatorMovement: aeolus.read("predatorMovement"),
    predatorSpeedMps: aeolus.read("predatorSpeedMps"),
    solarW: aeolus.read("solarW"),
    batteryPct: aeolus.read("batteryPct"),
    armed: aeolus.read("armed"),
    activeUntil: aeolus.read("activeUntil"),
    lastSpecies: aeolus.read("lastSpecies"),
    lastCategory: aeolus.read("lastCategory"),
    responsesToday: aeolus.read("responsesToday"),
    commandPending: aeolus.read("commandPending"),
    lastVerifiedAt: aeolus.read("lastVerifiedAt"),
    lastVerifiedTarget: aeolus.read("lastVerifiedTarget"),
    lastOutcome: aeolus.read("lastOutcome"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    toggleArmed: () => aeolus.fire("toggle-armed"),
    stopDeterrent: () => aeolus.fire("stop-deterrent"),
  };

  return <PredatorResponsePanel model={model} actions={actions} />;
}
