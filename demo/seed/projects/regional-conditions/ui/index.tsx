// Regional Conditions — UI entry point.
// At a glance: one Northern Rivers map with measured river heights and rainfall from
// WaterNSW gauges and NSW RFS incidents, beside fire danger, the selected gauge's retained
// history and the status of every source. Rendering detail lives in Files.

import { readHistory } from "./history";
import { toModel } from "./model";
import RegionalConditionsDashboard from "./RegionalConditionsDashboard";

export default function RegionalConditions(aeolus: CustomComponentProps) {
  const read = (key: string) => aeolus.read(key);
  const model = toModel(read, (key) => readHistory(read, key) as Record<string, unknown>);

  const actions = {
    refresh: () => aeolus.fire("refresh"),
  };

  return <RegionalConditionsDashboard model={model} actions={actions} />;
}
