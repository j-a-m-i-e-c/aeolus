// WaterNSW real-time Hydstra web service: request plumbing, time and quality codes.
//
// Keyless and public. Data © State of New South Wales through WaterNSW; every use must
// carry that notice, and the pane shows it beside the river and rainfall layers.
//
// This is the service behind WaterNSW's real-time data site, not the subscription API on
// its developer portal. It publishes no versioned contract, so every shape is checked
// and a change surfaces as a source error rather than as wrong numbers.

import { fetchFeed, parseJson, plain } from './feeds';

// `.exe`, not the `.pl` address the community documentation gives: `.pl` answers 301
// to this one, and outbound requests from an automation never follow redirects.
const HYDSTRA_URL = 'https://realtimedata.waternsw.com.au/cgi/webservice.exe?';
// The service answers 502 to a request with no User-Agent.
const HEADERS = { 'User-Agent': 'Aeolus showcase (github.com/j-a-m-i-e-c/aeolus)' };
// Its speed varies a lot over the day. Measured from two networks, even a one-station
// query took 2 to 6 s at some times and 9 to 18 s at others, so the default 10 s limit
// failed for long stretches. 22 s leaves some isolate budget for processing; the RFS feeds
// answer in well under a second and keep the default.
const TIMEOUT_MS = 22000;
// A fast 408 is retried once with a shorter limit, so the retry still finishes inside
// the run's 30 s completion budget: at most 3 s + 20 s.
const RETRY_WITHIN_MS = 3000;
const RETRY_TIMEOUT_MS = 20000;

// Every Northern Rivers site reports `timezone: "10.0"`: AEST all year, no daylight saving.
const AEST_OFFSET_MS = 10 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

export interface HydstraPoint { v: string; t: number; q: number }
export interface HydstraTrace {
  site: string;
  error_num: number;
  trace?: HydstraPoint[];
  quality_codes?: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → Hydstra `yyyymmddhhmmss` in AEST. */
export function hydstraTime(ms: number): string {
  const d = new Date(ms + AEST_OFFSET_MS);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00';
}

/** Hydstra `yyyymmddhhmmss` in AEST → epoch ms, or null if it is not one. */
export function fromHydstraTime(value: unknown): number | null {
  const s = String(value ?? '');
  if (!/^\d{14}$/.test(s)) return null;
  const year = +s.slice(0, 4), month = +s.slice(4, 6), day = +s.slice(6, 8);
  const hour = +s.slice(8, 10), minute = +s.slice(10, 12), second = +s.slice(12, 14);
  if (year < 2000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  const utc = local - AEST_OFFSET_MS;
  return utc <= Date.now() + 5 * 60 * 1000 ? utc : null;
}

/**
 * One `get_ts_traces` call for many sites.
 *
 * `variable` is 100 for stream water level (metres) or 10 for rainfall (millimetres).
 * `point` returns each logged reading; `tot` returns hourly totals, each stamped with the
 * START of its hour (verified against the raw tips: 15:00 = 15:00 to 16:00).
 */
export async function getTraces(sites: string[], variable: '100' | '10', dataType: 'point' | 'tot', now: number, hours: number): Promise<HydstraTrace[]> {
  // Totals are bucketed from the start time, so an unaligned start (14:11) produces hours
  // like 14:11 to 15:11 that never match a complete logged hour and all come back as 255.
  const start = now - hours * HOUR_MS;
  const query = {
    function: 'get_ts_traces',
    version: 2,
    params: {
      site_list: sites.join(','),
      start_time: hydstraTime(dataType === 'tot' ? Math.floor(start / HOUR_MS) * HOUR_MS : start),
      end_time: hydstraTime(now),
      varfrom: variable,
      varto: variable,
      interval: 'hour',
      multiplier: '1',
      datasource: 'CP',
      data_type: dataType,
    },
  };
  const url = HYDSTRA_URL + encodeURIComponent(JSON.stringify(query)) + '&ver=2';
  const started = Date.now();
  let body: string;
  try {
    body = await fetchFeed(url, { headers: HEADERS, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    // When busy, the service often answers 408 within a second or two, and asking again
    // usually works (1 in 8 requests in testing). One immediate retry, for that case only:
    // the sandbox has no timer to wait with, and a retry after a slow failure could run
    // past the automation's completion budget.
    if (!/HTTP 408/.test(String((error as Error)?.message)) || Date.now() - started > RETRY_WITHIN_MS) throw error;
    body = await fetchFeed(url, { headers: HEADERS, timeoutMs: RETRY_TIMEOUT_MS });
  }
  const parsed = parseJson(body, 'WaterNSW');
  // Errors arrive with HTTP 200 and a non-zero error_num.
  if (parsed?.error_num !== 0) throw new Error('WaterNSW error ' + String(parsed?.error_num) + ': ' + plain(parsed?.error_msg, 80));
  const traces = parsed?.return?.traces;
  if (!Array.isArray(traces)) throw new Error('Unexpected WaterNSW response');
  return traces;
}

export type Quality = 'checked' | 'unchecked' | 'suspect';

/**
 * Hydstra quality codes, as WaterNSW uses them here.
 *
 *   10, 15, 20, 125   good or fair, or telemetry that passed gross error checks
 *   30, 55, 59, 60    poor, flat-lined, flagged spike, or estimated: shown, marked suspect
 *   255               no data for this period: not a reading at all
 *   anything else     e.g. 130 "not quality coded, subject to change": shown as unchecked
 *
 * A suspect reading is never hidden. Hiding it would make a gauge look quiet when it is
 * the reading itself that is in doubt.
 */
export function qualityOf(code: number): Quality | null {
  if (code === 255) return null;
  if ([10, 15, 20, 125].includes(code)) return 'checked';
  if ([30, 55, 59, 60].includes(code)) return 'suspect';
  return 'unchecked';
}

export function qualityNote(trace: HydstraTrace, code: number): string {
  return plain(trace.quality_codes?.[String(code)], 80) || 'Quality code ' + code;
}

/** Validated readings of one trace, oldest first. */
export function readings(trace: HydstraTrace, min: number, max: number) {
  const out: { t: number; v: number; q: number; quality: Quality }[] = [];
  for (const point of Array.isArray(trace.trace) ? trace.trace : []) {
    const t = fromHydstraTime(point?.t);
    const v = Number(point?.v);
    const quality = qualityOf(Number(point?.q));
    if (t === null || !quality || !Number.isFinite(v) || v < min || v > max) continue;
    out.push({ t, v, q: Number(point.q), quality });
  }
  return out.sort((a, b) => a.t - b.t);
}
