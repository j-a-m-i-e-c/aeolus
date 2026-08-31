// Space — UI entry point.
// At a glance: live ISS position, orbit geometry, NOAA space weather, Moon and launch schedules.
// State selection and operator intent stay visible; rendering detail lives in Files.

import LiveSpaceDashboard from "./LiveSpaceDashboard";

export default function Space(aeolus: CustomComponentProps) {
  const model = {
    iss: aeolus.read("iss"),
    issAscending: aeolus.read("issAscending"),
    launches: aeolus.read("launches"),
    kp: aeolus.read("kp"),
    solarWind: aeolus.read("solarWind"),
    flare: aeolus.read("flare"),
    aurora: aeolus.read("aurora"),
    moon: aeolus.read("moon"),
    moonPhases: aeolus.read("moonPhases"),
    issUpdated: aeolus.read("issUpdated"),
  };

  const actions = {
    refresh: () => aeolus.fire("refresh"),
  };

  return <LiveSpaceDashboard model={model} actions={actions} />;
}
