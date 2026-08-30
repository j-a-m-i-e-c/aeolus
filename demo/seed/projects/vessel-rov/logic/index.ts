// ROV Operations — orchestration entry point.
// Vehicle commands remain operator-driven; tether protection can always force hold.

import { handleRovOperatorEvent, projectRovState, protectRovTether } from "./rov-operations";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    await handleRovOperatorEvent(event);
    return;
  }

  const rov = projectRovState();
  if (rov.tether >= 650) {
    await protectRovTether();
  }
}
