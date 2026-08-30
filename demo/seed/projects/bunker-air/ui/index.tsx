// Air & Filtration — UI composition entry point.
// State selection and operator intent stay visible; rendering detail lives in Files.

import AirFiltrationPanel from "./AirFiltrationPanel";

export default function AirFiltration(aeolus: CustomComponentProps) {
  const model = {
    sealed: aeolus.read("sealed"),
    overpressure: aeolus.read("overpressure"),
    filterLife: aeolus.read("filterLife"),
    pending: aeolus.read("pending"),
    lastAction: aeolus.read("lastAction"),
  };

  const actions = {
    seal: () => aeolus.fire("seal"),
    unseal: () => aeolus.fire("unseal"),
  };

  return <AirFiltrationPanel model={model} actions={actions} />;
}
