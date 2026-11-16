// Regional Conditions — UI entry point.
// At a glance: one Northern Rivers map with measured river heights and rainfall from
// WaterNSW gauges and NSW RFS incidents, beside fire danger, the selected gauge's retained
// history and the status of every source. Rendering detail lives in Files.

import RegionalConditionsDashboard from "./RegionalConditionsDashboard";

export default function RegionalConditions(aeolus: CustomComponentProps) {
  const model = {
    riverGauges: aeolus.read("riverGauges"),
    riverHistory: aeolus.read("riverHistory"),
    riverUpdated: aeolus.read("riverUpdated"),
    riverError: aeolus.read("riverError"),
    rainGauges: aeolus.read("rainGauges"),
    rainHistory: aeolus.read("rainHistory"),
    rainUpdated: aeolus.read("rainUpdated"),
    rainError: aeolus.read("rainError"),
    fireDanger: aeolus.read("fireDanger"),
    fireDangerUpdated: aeolus.read("fireDangerUpdated"),
    fireDangerError: aeolus.read("fireDangerError"),
    incidents: aeolus.read("incidents"),
    incidentsUpdated: aeolus.read("incidentsUpdated"),
    incidentsError: aeolus.read("incidentsError"),
  };

  const actions = {
    refresh: () => aeolus.fire("refresh"),
  };

  return <RegionalConditionsDashboard model={model} actions={actions} />;
}
