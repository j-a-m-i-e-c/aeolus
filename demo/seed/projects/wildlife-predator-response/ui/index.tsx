// Predator Response — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import PredatorResponsePanel from "./PredatorResponsePanel";

export default function PredatorResponse(aeolus: CustomComponentProps) {
  const model = {
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
