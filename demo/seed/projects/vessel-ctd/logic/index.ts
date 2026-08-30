// CTD Operations — orchestration entry point.
// Project telemetry first, then enforce the winch cable-tension interlock.

import {
  handleCtdOperatorEvent,
  projectCtdState,
  protectCtdTension,
} from "./ctd-operations";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    await handleCtdOperatorEvent(event);
    return;
  }

  const ctd = projectCtdState();
  if (ctd.tension >= 650 && ctd.winchOn) {
    await protectCtdTension();
  }
}
