// Regional Conditions — UI entry point.
// At a glance: one Northern Rivers map with measured river heights and rainfall from
// WaterNSW gauges and NSW RFS incidents, beside fire danger, the selected gauge's retained
// history and the status of every source. Rendering detail lives in Files.

import { readHistory } from "./history";
import RegionalConditionsDashboard from "./RegionalConditionsDashboard";

export default function RegionalConditions(aeolus: CustomComponentProps) {
  const model = {
    radarFrames: aeolus.read("radarFrames"),
    riverGauges: aeolus.read("riverGauges"),
    riverHistory: readHistory((key) => aeolus.read(key), "riverHistory"),
    riverUpdated: aeolus.read("riverUpdated"),
    riverError: aeolus.read("riverError"),
    rainGauges: aeolus.read("rainGauges"),
    rainHistory: readHistory((key) => aeolus.read(key), "rainHistory"),
    rainUpdated: aeolus.read("rainUpdated"),
    rainError: aeolus.read("rainError"),
    fireDanger: aeolus.read("fireDanger"),
    fireDangerUpdated: aeolus.read("fireDangerUpdated"),
    fireDangerError: aeolus.read("fireDangerError"),
    incidents: aeolus.read("incidents"),
    incidentsUpdated: aeolus.read("incidentsUpdated"),
    incidentsError: aeolus.read("incidentsError"),
    lastFetchAttempt: aeolus.read("lastFetchAttempt"),
  };

  const actions = {
    refresh: () => aeolus.fire("refresh"),
  };

  return <RegionalConditionsDashboard model={model} actions={actions} />;
}
