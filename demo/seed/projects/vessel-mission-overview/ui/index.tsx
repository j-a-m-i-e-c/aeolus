// Mission Overview — UI composition entry point.
// At a glance: CTD, ROV and underway-science summaries compose the vessel mission picture.

import MissionOverviewDashboard from "./MissionOverviewDashboard";

export default function MissionOverview(aeolus: CustomComponentProps) {
  const model = {
    ctdDepth: aeolus.read("ctdDepth"),
    ctdStatus: aeolus.read("ctdStatus"),
    ctdTemperature: aeolus.read("ctdTemperature"),
    ctdSalinity: aeolus.read("ctdSalinity"),
    ctdTension: aeolus.read("ctdTension"),
    rovDepth: aeolus.read("rovDepth"),
    rovMode: aeolus.read("rovMode"),
    rovBattery: aeolus.read("rovBattery"),
    rovTether: aeolus.read("rovTether"),
    tsgFlow: aeolus.read("tsgFlow"),
    sst: aeolus.read("sst"),
    surfaceSalinity: aeolus.read("surfaceSalinity"),
    chlorophyll: aeolus.read("chlorophyll"),
    frontDetected: aeolus.read("frontDetected"),
    lastMissionEvent: aeolus.read("lastMissionEvent"),
  };
  return <MissionOverviewDashboard model={model} />;
}
