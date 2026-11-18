// Regional Conditions — orchestration entry point.
// Four independent public sources for the Northern Rivers, plus an optional local
// RainViewer radar collector. Radar comes through the local MQTT device registry, never
// through a remote source request from this Automation Project.

import { updateFireDanger, updateIncidents } from './rfs';
import { ingestRadar } from './radar';
import { updateRainfall } from './rainfall';
import { updateRiverLevels } from './river';

// Cron runs every two minutes to pick up locally published radar frames, while the
// four public feeds retain a separate five-minute minimum. Manual Refresh is subject
// to the same public-feed limit.
// The pane disables Refresh for the same period (ui/freshness.ts REFRESH_FLOOR_MS).
const MIN_REFRESH_MS = 5 * 60 * 1000;

export default async function run() {
  const now = Date.now();
  // Showcase seed rules have ONE trigger type: cron or MQTT, not both. Read the
  // latest radar device snapshot each run instead of assuming an MQTT trigger was
  // registered. A second run with the same frame does not write duplicate state.
  const radar = devices.list().find((device) => device.topic === 'aeolus/local/radar/northern-rivers');
  ingestRadar(radar?.state, now);
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
