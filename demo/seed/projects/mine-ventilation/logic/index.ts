// Ventilation Control — orchestration entry point.
// Atmospheric Safety publishes demand; this project owns the physical fan mode.

import {
  commandVentilation,
  handleVentilationOperatorEvent,
  projectVentilationState,
} from "./ventilation-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    await handleVentilationOperatorEvent(event);
    return;
  }

  if (!topic.includes("/mine/atmosphere/vent-demand")) return;

  const payload = context.state && typeof context.state === "object" ? context.state : {};
  const demand = Number(payload.demand || 48);
  const severity = String(payload.severity || "safe");
  state.set("requestedDemand", demand);
  state.set("atmosphereSeverity", severity);

  if (Boolean(state.get("manualOverride"))) {
    projectVentilationState();
    return;
  }

  await commandVentilation(
    demand >= 80 ? "boost" : "auto",
    demand >= 80
      ? "Atmospheric Safety requested maximum ventilation"
      : "Atmosphere safe · ventilation returned to demand control",
  );
}
