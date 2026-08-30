// Power & Supplies — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import PowerSuppliesPanel from "./PowerSuppliesPanel";

export default function PowerSupplies(aeolus: CustomComponentProps) {
  const model = {
    battery: aeolus.read("battery"),
    solar: aeolus.read("solar"),
    load: aeolus.read("load"),
    net: aeolus.read("net"),
    generatorOn: aeolus.read("generatorOn"),
    fuel: aeolus.read("fuel"),
    foodDays: aeolus.read("foodDays"),
    waterDays: aeolus.read("waterDays"),
    beans: aeolus.read("beans"),
    pending: aeolus.read("pending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    generatorOn: () => aeolus.fire("generator-on"),
    generatorOff: () => aeolus.fire("generator-off"),
    simulateLowPower: () => aeolus.fire("simulate-low-power"),
    resetPower: () => aeolus.fire("reset-power"),
  };

  return <PowerSuppliesPanel model={model} actions={actions} />;
}
