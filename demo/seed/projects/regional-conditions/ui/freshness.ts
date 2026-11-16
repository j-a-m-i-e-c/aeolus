// How old is too old, decided per reading from its own observation time.
//
//   current      observed within the source's normal reporting delay
//   stale        older than that; shown with its observation time
//   unavailable  no valid reading at all; no value and no trend are shown
//
// Classified here in the pane rather than stored by the Logic, because a reading's age
// keeps growing between refreshes and a stored verdict would go wrong on its own.
// A gauge that has not reported is not necessarily broken: some only report often while
// it is wet. So "stale" says when the reading is from and claims nothing about why.

export type Freshness = 'current' | 'stale' | 'unavailable';

const HOUR = 3600 * 1000;
// WaterNSW logs every 15 minutes and publishes about one to two hours behind.
export const RIVER_CURRENT_MS = 3 * HOUR;
// An hourly rain total is complete only once its hour has ended and the logger has
// uploaded past it. In a live check the latest complete hour had ended 2.8 to 3.8 hours
// earlier, so a tighter limit would flip working gauges to stale between uploads.
export const RAIN_CURRENT_MS = 5 * HOUR;

// Mirrors MIN_REFRESH_MS in logic/index.ts. A Refresh pressed sooner is ignored by the
// Logic, so the button says so and waits instead of appearing to do nothing.
export const REFRESH_FLOOR_MS = 5 * 60 * 1000;

export function freshness(observedAt: unknown, now: number, limitMs: number): Freshness {
  const t = Number(observedAt);
  if (!Number.isFinite(t) || t <= 0) return 'unavailable';
  return now - t <= limitMs ? 'current' : 'stale';
}

export function ago(at: unknown, now: number): string {
  const t = Number(at);
  if (!Number.isFinite(t) || t <= 0) return 'never';
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 90) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  return hours < 48 ? hours + ' h ago' : Math.round(hours / 24) + ' d ago';
}

export function clock(at: unknown): string {
  const t = Number(at);
  if (!Number.isFinite(t) || t <= 0) return 'unknown time';
  return new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Rate of change, metres per hour. Below 5 cm/h is read as steady: telemetry wobbles by
// a few millimetres even on a still river.
export type Trend = 'rising' | 'falling' | 'steady';
export function trendOf(change1h: unknown): Trend | null {
  const c = Number(change1h);
  if (change1h === null || change1h === undefined || !Number.isFinite(c)) return null;
  return c > 0.05 ? 'rising' : c < -0.05 ? 'falling' : 'steady';
}

// Status text colours. Marker colours live in markers.tsx, one palette per layer.
export const TONE = {
  stale: '#73848E',
  good: '#8BDDB9',
  warn: '#EAB77B',
};

/** One source's status line: last good refresh, and the latest failure if any. */
export function sourceStatus(updatedAt: unknown, error: unknown, now: number, expectMs: number) {
  const ok = Number(updatedAt) > 0;
  const failed = typeof error === 'string' && error.length > 0;
  if (!ok && !failed) return { label: 'Waiting for first refresh', tone: TONE.stale };
  if (!ok) return { label: 'Unavailable: ' + error, tone: TONE.warn };
  if (failed) return { label: 'Last refresh failed (' + error + '). Showing data from ' + ago(updatedAt, now), tone: TONE.warn };
  if (now - Number(updatedAt) > expectMs) return { label: 'Not refreshed since ' + ago(updatedAt, now), tone: TONE.warn };
  return { label: 'Refreshed ' + ago(updatedAt, now), tone: TONE.good };
}
