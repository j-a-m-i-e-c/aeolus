// Power & Supplies — UI composition entry point.
// At a glance: solar + battery reserves, shelter supplies and verified backup-generator control.

import PowerSuppliesPanel from "./PowerSuppliesPanel";

import { createDemoActions } from "./demo-actions";

export default function PowerSupplies(aeolus: CustomComponentProps) {
  const model = {
    battery: aeolus.read("battery"),
    solar: aeolus.read("solar"),
    load: aeolus.read("load"),
    net: aeolus.read("net"),
    generatorOn: aeolus.read("generatorOn"),
    generatorOutputW: aeolus.read("generatorOutputW"),
    charging: aeolus.read("charging"),
    fuel: aeolus.read("fuel"),
    lastCommand: aeolus.read("lastCommand"),
    foodDays: aeolus.read("foodDays"),
    waterDays: aeolus.read("waterDays"),
    waterLitres: aeolus.read("waterLitres"),
    waterDailyLitres: aeolus.read("waterDailyLitres"),
    medicalCheckedDaysAgo: aeolus.read("medicalCheckedDaysAgo"),
    occupants: aeolus.read("occupants"),
    beans: aeolus.read("beans"),
    pending: aeolus.read("pending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    generatorOn: () => aeolus.fire("generator-on"),
    generatorOff: () => aeolus.fire("generator-off"),
    ...createDemoActions(aeolus),
  };

  return <PowerSuppliesPanel model={model} actions={actions} />;
}
