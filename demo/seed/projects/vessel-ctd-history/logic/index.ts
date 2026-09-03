// CTD History — orchestration entry point.
//
// How often the cast record is written is a retention decision, so it runs on
// this automation's own schedule and reads the sonde directly. Sampling from CTD
// Operations' telemetry path made the record's density a function of how often the
// sonde published, and tied the sampling interval to the publish interval.

import { noteSkipped, readCast } from "./sampler";

export default function run() {
  // The Data Store is an optional platform capability. Without it there is
  // nothing to sample into, so record why and stop rather than failing on a
  // schedule.
  if (typeof db === "undefined") {
    noteSkipped("Data Store not enabled");
    return;
  }

  const cast = readCast();
  if (!cast) return;

  db.write("ctd-casts", cast);
  state.set("lastSampleAt", Date.now());
  state.set("lastSample", cast);
  noteSkipped(null);
}
