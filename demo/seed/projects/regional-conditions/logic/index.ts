// Regional Conditions — orchestration entry point.
// Four independent public sources for the Northern Rivers, each refreshed and tracked on
// its own: river heights and rainfall measured by WaterNSW gauges, and NSW RFS fire
// danger and incidents. Nothing here is simulated, modelled or radar.

import { updateFireDanger, updateIncidents } from './rfs';
import { updateRainfall } from './rainfall';
import { updateRiverLevels } from './river';

// Cron runs every ten minutes; the pane's Refresh button can ask sooner. Both pass
// through this floor, so visitors pressing Refresh cannot hammer public services.
const MIN_REFRESH_MS = 5 * 60 * 1000;

export default async function run(_context: EventContext) {
  const now = Date.now();
  const previous = Number(state.get('lastFetchAttempt')) || 0;
  if (now - previous < MIN_REFRESH_MS) return;
  state.set('lastFetchAttempt', now);

  // Concurrently, and each one isolated: every updater records its own failure and
  // keeps its last good data, so a slow or broken source never blanks the others.
  // Run one after another, four requests of up to 10 s each could outlast the run.
  await Promise.all([
    updateRiverLevels(now),
    updateRainfall(now),
    updateFireDanger(now),
    updateIncidents(now),
  ]);
}
