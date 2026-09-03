// Dewatering History — orchestration entry point.
//
// How often the sump record is written is a retention decision, so it runs on this
// automation's own schedule and reads the sump and pump directly. Sampling from
// Dewatering's telemetry path made the record's density a function of how often the
// sump published, and tied the sampling interval to the publish interval.

import { noteSkipped, readSump } from "./sampler";

export default function run() {
  // The Data Store is an optional platform capability. Without it there is
  // nothing to sample into, so record why and stop rather than failing on a
  // schedule.
  if (typeof db === "undefined") {
    noteSkipped("Data Store not enabled");
    return;
  }

  const sump = readSump();
  if (!sump) return;

  db.write("mine-water", sump);
  state.set("lastSampleAt", Date.now());
  state.set("lastSample", sump);
  noteSkipped(null);
}
