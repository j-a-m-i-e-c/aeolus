// Water History — orchestration entry point.
//
// How often site history is recorded is a retention decision, not a property of
// how talkative the tanks happen to be. This automation runs on its own schedule
// and reads current device state, rather than riding on whichever telemetry
// message happens to arrive next. Keeping it out of the Water Management control
// loop also decouples the sampling interval from the publish interval, so a burst
// of coherent telemetry no longer decides whether a sample is taken.

import { noteSkipped, readTankLevels } from "./sampler";

export default function run() {
  // The Data Store is an optional platform capability. Without it there is
  // nothing to sample into, so record why and stop rather than failing on a
  // schedule.
  if (typeof db === "undefined") {
    noteSkipped("Data Store not enabled");
    return;
  }

  const levels = readTankLevels();
  if (!levels) return;

  db.write("tank-levels", levels);
  state.set("lastSampleAt", Date.now());
  state.set("lastSample", levels);
  noteSkipped(null);
}
