// NSW Rural Fire Service: district fire danger and major incidents.
//
// Both feeds are public and keyless. Fire data © State of New South Wales (NSW Rural
// Fire Service). Positions in the incident feed can be approximate.

import { decodeEntities, fetchFeed, parseJson, plain, reason, withinMap } from './feeds';

const FIRE_DANGER_URL = 'https://www.rfs.nsw.gov.au/feeds/fdrToban.xml';
const INCIDENTS_URL = 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.json';
const DISTRICT = 'Far North Coast';
// The councils the fire danger feed itself lists for the Far North Coast district.
const DISTRICT_COUNCILS = ['ballina', 'byron', 'clarence valley', 'kyogle', 'lismore', 'richmond valley', 'tweed'];
const MAX_INCIDENTS = 60;
const MAX_FEATURES = 2500;

// ─── Fire danger ─────────────────────────────────────────────────────────────

function readTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i'));
  return match ? decodeEntities(match[1].trim()) : null;
}

const rating = (value: string | null) => value && /^[A-Za-z][A-Za-z \-/]{0,39}$/.test(value) ? value : null;
const ban = (value: string | null) => value === 'Yes' ? true : value === 'No' ? false : null;

export function parseFireDanger(xml: string) {
  if (!xml.includes('<FireDangerMap')) throw new Error('Unexpected RFS fire danger feed');
  const blocks = xml.match(/<District(?:\s[^>]*)?>[\s\S]*?<\/District\s*>/gi) || [];
  const district = blocks.find((block) => readTag(block, 'Name') === DISTRICT);
  if (!district) throw new Error(DISTRICT + ' is missing from the RFS feed');
  const today = rating(readTag(district, 'DangerLevelToday'));
  const tomorrow = rating(readTag(district, 'DangerLevelTomorrow'));
  if (!today || !tomorrow) throw new Error('RFS feed has no fire danger rating for ' + DISTRICT);
  return {
    district: DISTRICT,
    today,
    tomorrow,
    fireBanToday: ban(readTag(district, 'FireBanToday')),
    fireBanTomorrow: ban(readTag(district, 'FireBanTomorrow')),
  };
}

// ─── Incidents ───────────────────────────────────────────────────────────────

/**
 * The RFS packs an incident's details into `description` as `KEY: value` lines separated
 * by `<br />`: alert level, location, council area, status, type, size, agency, updated.
 * The feature properties carry only title, link, category, guid, pubDate and description.
 */
export function parseDescription(html: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of String(html ?? '').split(/<br\s*\/?>/i)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z ]{1,30}):\s*([\s\S]*)$/);
    if (match) fields[match[1].trim().toLowerCase()] = plain(match[2]);
  }
  return fields;
}

// A GeometryCollection can hold the reported point and a mapped fire extent. Only a
// reported point is used: a location is never invented from a polygon.
function pointOf(geometry: any): [number, number] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
  }
  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    for (const item of geometry.geometries) {
      const point = pointOf(item);
      if (point) return point;
    }
  }
  return null;
}

const ALERT_RANK: Record<string, number> = { 'emergency warning': 3, 'watch and act': 2, advice: 1 };
const rank = (alert: string) => ALERT_RANK[alert.toLowerCase()] ?? 0;

export function parseIncidents(raw: string) {
  const collection = parseJson(raw, 'RFS incident feed');
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Unexpected RFS incident feed');
  }
  if (collection.features.length > MAX_FEATURES) throw new Error('RFS incident feed unexpectedly large');

  const incidents: any[] = [];
  for (const feature of collection.features) {
    if (!feature || feature.type !== 'Feature') continue;
    const p = feature.properties || {};
    const details = parseDescription(p.description);
    const council = details['council area'] || '';
    const point = pointOf(feature.geometry);
    const mapped = !!point && withinMap(point[0], point[1]);
    const inDistrict = DISTRICT_COUNCILS.some((name) => council.toLowerCase().includes(name));
    if (!mapped && !inDistrict) continue;
    incidents.push({
      id: plain(p.guid || p.link || p.title) || 'incident-' + incidents.length,
      title: plain(p.title) || 'Unnamed incident',
      // `category` repeats the alert level for most incidents and is the fallback.
      alert: details['alert level'] || plain(p.category),
      status: details.status || '',
      type: details.type || '',
      council,
      location: details.location || '',
      size: details.size || '',
      agency: details['responsible agency'] || '',
      updated: details.updated || plain(p.pubDate),
      // In the district but reported outside the map frame, or with no point at all:
      // listed beside the map rather than pinned somewhere it is not.
      lon: mapped ? point![0] : null,
      lat: mapped ? point![1] : null,
    });
  }
  // Emergency Warning first, then Watch and Act, then Advice: the order a reader needs.
  return incidents.sort((a, b) => rank(b.alert) - rank(a.alert)).slice(0, MAX_INCIDENTS);
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export async function updateFireDanger(now: number) {
  try {
    state.set('fireDanger', parseFireDanger(await fetchFeed(FIRE_DANGER_URL)));
    state.set('fireDangerUpdated', now);
    state.set('fireDangerError', '');
  } catch (error) {
    // The last good rating is kept; the pane marks it stale from fireDangerUpdated.
    state.set('fireDangerError', reason(error));
    log.warn('RFS fire danger: ' + reason(error));
  }
}

export async function updateIncidents(now: number) {
  try {
    state.set('incidents', parseIncidents(await fetchFeed(INCIDENTS_URL)));
    state.set('incidentsUpdated', now);
    state.set('incidentsError', '');
  } catch (error) {
    state.set('incidentsError', reason(error));
    log.warn('RFS incidents: ' + reason(error));
  }
}
