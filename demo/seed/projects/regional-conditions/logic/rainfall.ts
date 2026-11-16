// Observed rainfall from WaterNSW rain gauges, as hourly totals retained by Aeolus.
//
// These are tipping-bucket measurements at 19 stations, not radar and not a model. The
// pane draws them as individual stations: there are too few to interpolate a surface
// honestly, and a smooth field between them would show rain nobody measured.

import { reason } from './feeds';
import { RAIN_STATIONS } from './stations';
import { getTraces, readings, type HydstraTrace } from './waternsw';

const HOUR_MS = 3600 * 1000;
// The latest complete hour is typically three to four hours old by the time it can be
// read. An hour still being logged comes back with quality 255 ("data unavailable") and
// is skipped until it is complete, so the window reaches back far enough to catch it.
const WINDOW_HOURS = 6;
const HISTORY_MS = 24 * HOUR_MS;
const MAX_HOURLY_MM = 300;

type Hour = { t: number; mm: number };

/**
 * Merge one response of hourly totals into the retained 24 hours for each gauge.
 *
 * Hours are keyed by their start, so a re-sent hour replaces the earlier value: interim
 * totals can still be revised while they are "not quality coded".
 */
export function projectRain(traces: HydstraTrace[], previousGauges: unknown, previousHistory: unknown, now: number) {
  const byId = new Map(traces.map((trace) => [String(trace?.site), trace]));
  const prior = new Map((Array.isArray(previousGauges) ? previousGauges : []).map((g: any) => [g?.id, g]));
  const old = previousHistory && typeof previousHistory === 'object' && !Array.isArray(previousHistory)
    ? previousHistory as Record<string, Hour[]> : {};
  const history: Record<string, Hour[]> = {};

  const gauges = RAIN_STATIONS.map((station) => {
    const base = { id: station.id, name: station.name, lon: station.lon, lat: station.lat };
    const hours = new Map<number, number>();
    for (const h of Array.isArray(old[station.id]) ? old[station.id] : []) {
      if (Number.isFinite(h?.t) && Number.isFinite(h?.mm)) hours.set(h.t, h.mm);
    }
    const trace = byId.get(station.id);
    let suspect = false;
    for (const point of trace && trace.error_num === 0 ? readings(trace, 0, MAX_HOURLY_MM) : []) {
      hours.set(point.t, point.v);
      if (point.quality === 'suspect') suspect = true;
    }
    // Retain an hour while any of it is inside the last 24 hours.
    const kept = [...hours.entries()]
      .filter(([t]) => now - (t + HOUR_MS) < HISTORY_MS)
      .sort((a, b) => a[0] - b[0])
      .map(([t, mm]) => ({ t, mm }));
    history[station.id] = kept;

    const last = kept[kept.length - 1];
    if (!last) {
      const before = prior.get(station.id);
      return before && Number.isFinite(before.lastHourMm)
        ? { ...before, ...base }
        : { ...base, lastHourMm: null, observedAt: null, total24h: null, hoursCovered: 0, suspect: false };
    }
    return {
      ...base,
      lastHourMm: last.mm,
      // A total is observed at the END of its hour.
      observedAt: last.t + HOUR_MS,
      total24h: Number(kept.reduce((sum, h) => sum + h.mm, 0).toFixed(1)),
      hoursCovered: kept.length,
      suspect,
    };
  });

  return { gauges, history };
}

export async function updateRainfall(now: number) {
  try {
    const traces = await getTraces(RAIN_STATIONS.map((s) => s.id), '10', 'tot', now, WINDOW_HOURS);
    const { gauges, history } = projectRain(traces, state.get('rainGauges'), state.get('rainHistory'), now);
    state.set('rainGauges', gauges);
    state.set('rainHistory', history);
    state.set('rainUpdated', now);
    state.set('rainError', '');
  } catch (error) {
    state.set('rainError', reason(error));
    log.warn('WaterNSW rainfall: ' + reason(error));
  }
}
