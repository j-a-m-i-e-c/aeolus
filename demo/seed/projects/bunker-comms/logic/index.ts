// Communications — orchestration entry point.

import { handleCommsDemoEvent, projectRadioState, transmitCheckIn } from "./radio-control";

export default async function run(context: EventContext) {
  const topic = String(context.topic || "");
  const event = topic.split("/").pop();

  if (topic.startsWith("ui/")) {
    if (event === "transmit-checkin") await transmitCheckIn();
    else handleCommsDemoEvent(event);
    return;
  }

  if (topic.startsWith("sensor/bunker/radio/")) {
    projectRadioState();
  }
}
