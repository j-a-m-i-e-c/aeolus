// Atmospheric History — orchestration entry point.
//
// How often the gas record is written is a retention decision, so it runs on this
// automation's own schedule and reads the multi-gas head directly. Sampling from
// Atmospheric Safety's telemetry path made the record's density a function of how
// often the head published, and tied the sampling interval to the publish interval.
//
// Recording history here also keeps it clear of the safety path: the alarm and
// ventilation-demand policy must react to every reading, whereas the record only
// needs a regular one.

import { noteSkipped, readGases } from "./sampler";

export default function run() {
  // The Data Store is an optional platform capability. Without it there is
  // nothing to sample into, so record why and stop rather than failing on a
  // schedule.
  if (typeof db === "undefined") {
    noteSkipped("Data Store not enabled");
    return;
  }

  const gases = readGases();
  if (!gases) return;

  db.write("gas-readings", gases);
  state.set("lastSampleAt", Date.now());
  state.set("lastSample", gases);
  noteSkipped(null);
}
