// Live Space — orchestration entry point.
// One automation composes several fixed public data sources at sensible cadences.

import {
  updateIss,
  updateLaunches,
  updateMoon,
  updateSpaceWeather,
} from "./live-space";

export default async function run(_context: EventContext) {
  const now = Date.now();

  // ISS position is the fast-moving source and refreshes every run.
  await updateIss(now);

  // Slower sources self-throttle behind their own cache windows.
  await updateLaunches(now);      // 30 minutes
  await updateSpaceWeather(now);  // 15 minutes
  await updateMoon(now);          // 6 hours
}
