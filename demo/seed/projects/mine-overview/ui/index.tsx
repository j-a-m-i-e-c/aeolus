// Mine Operations Overview — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import MineOperationsDashboard from "./MineOperationsOverview";

export default function MineOperationsOverview(aeolus: CustomComponentProps) {
  const model = {
    d7Ch4: aeolus.read("d7Ch4"),
    severity: aeolus.read("severity"),
    ventMode: aeolus.read("ventMode"),
    airflow: aeolus.read("airflow"),
    refuge: aeolus.read("refuge"),
    underground: aeolus.read("underground"),
    unaccounted: aeolus.read("unaccounted"),
    musterState: aeolus.read("musterState"),
    sumpLevel: aeolus.read("sumpLevel"),
    sumpPumpOn: aeolus.read("sumpPumpOn"),
    lastMineEvent: aeolus.read("lastMineEvent"),
  };
  return <MineOperationsDashboard model={model} />;
}
