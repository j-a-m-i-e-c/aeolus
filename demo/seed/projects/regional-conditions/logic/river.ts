// River heights from WaterNSW stream gauges, with history retained by Aeolus.
//
// A gauge height is metres above that gauge's own datum. It is not a flood depth, it is
// not comparable between gauges, and nothing here turns it into a flood classification:
// WaterNSW does not publish those through this service, and inferring one from height
// alone would be a claim Aeolus cannot back.

import { reason } from './feeds';
import { readHistory, writeHistory } from './history-state';
import { LEVEL_STATIONS } from './stations';
import { getTraces, qualityNote, readings, type HydstraTrace } from './waternsw';

// Readings are logged every 15 minutes and appear about one to two hours late, so a
// three-hour window always holds the latest few. Requesting more every ten minutes would
// only re-download history this automation already keeps.
const WINDOW_HOURS = 3;
const HISTORY_MS = 24 * 3600 * 1000;
const HISTORY_SPACING_MS = 30 * 60 * 1000;
const TREND_SPAN_MS = 60 * 60 * 1000;
const MIN_LEVEL_M = -20;
const MAX_LEVEL_M = 200;

type Sample = { t: number; v: number; suspect: boolean };

function priorHistory(value: unknown): Record<string, Sample[]> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Sample[]> : {};
}

/**
 * Project one Hydstra level response onto every known gauge.
 *
 * A gauge with nothing in the window keeps its last known reading. Its age then makes the
 * pane show it as stale, which is the truth; dropping it would make the map look as if
 * the gauge had never existed. A gauge never seen has no height and no trend.
 */
export function projectRiver(traces: HydstraTrace[], previousGauges: unknown, previousHistory: unknown, now: number) {
  const byId = new Map(traces.map((trace) => [String(trace?.site), trace]));
  const prior = new Map((Array.isArray(previousGauges) ? previousGauges : []).map((g: any) => [g?.id, g]));
  const old = priorHistory(previousHistory);
  const history: Record<string, Sample[]> = {};

  const gauges = LEVEL_STATIONS.map((station) => {
    const base = { id: station.id, name: station.name, lon: station.lon, lat: station.lat };
    const trace = byId.get(station.id);
    const points = trace && trace.error_num === 0 ? readings(trace, MIN_LEVEL_M, MAX_LEVEL_M) : [];

    // Merge by observation time, replacing old values and quality when WaterNSW
    // revises a previously reported sample. Preserve 30-minute chart density.
    const samples = new Map<number, Sample>();
    for (const sample of Array.isArray(old[station.id]) ? old[station.id] : []) {
      if (Number.isFinite(sample?.t) && Number.isFinite(sample?.v)
          && sample.t <= now && now - sample.t <= HISTORY_MS) samples.set(sample.t, sample);
    }
    for (const point of points) {
      if (point.t <= now && now - point.t <= HISTORY_MS) {
        samples.set(point.t, { t: point.t, v: point.v, suspect: point.quality === 'suspect' });
      }
    }
    const byBucket = new Map<number, Sample>();
    for (const sample of [...samples.values()].sort((a, b) => a.t - b.t)) {
      byBucket.set(Math.floor(sample.t / HISTORY_SPACING_MS), sample);
    }
    history[station.id] = [...byBucket.values()].sort((a, b) => a.t - b.t);

    const latest = points[points.length - 1];
    if (!latest) {
      const before = prior.get(station.id);
      return before && Number.isFinite(before.level)
        ? { ...before, ...base, change1h: null }
        : { ...base, level: null, observedAt: null, quality: null, qualityNote: '', change1h: null };
    }

    // Rate over roughly the last hour, from readings that are not themselves in doubt.
    const reference = [...points].reverse()
      .find((p) => p.quality !== 'suspect' && latest.t - p.t >= TREND_SPAN_MS * 0.75);
    const change1h = latest.quality !== 'suspect' && reference
      ? Number(((latest.v - reference.v) * TREND_SPAN_MS / (latest.t - reference.t)).toFixed(3))
      : null;

    return {
      ...base,
      level: latest.v,
      observedAt: latest.t,
      quality: latest.quality,
      qualityNote: qualityNote(trace!, latest.q),
      change1h,
    };
  });

  return { gauges, history };
}

export async function updateRiverLevels(now: number) {
  try {
    const traces = await getTraces(LEVEL_STATIONS.map((s) => s.id), '100', 'point', now, WINDOW_HOURS);
    const { gauges, history } = projectRiver(traces, state.get('riverGauges'), readHistory('riverHistory'), now);
    state.set('riverGauges', gauges);
    writeHistory('riverHistory', history);
    state.set('riverUpdated', now);
    state.set('riverError', '');
  } catch (error) {
    // The last projection and its history are kept, and age into "stale" on the pane.
    state.set('riverError', reason(error));
    log.warn('WaterNSW river levels: ' + reason(error));
  }
}
