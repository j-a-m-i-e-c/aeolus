// Strict validation and Web Mercator geometry for RainViewer's public tile API.
// No map tiles are shipped into the Aeolus UI; only a sampled, compact colour grid.
export const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const TILE_HOST = 'https://tilecache.rainviewer.com';
export const REGION = Object.freeze({ west: 152, south: -30.2, east: 154.2, north: -27.7 });
export const ZOOM = 7; // maximum free API zoom in November 2026
export const TILE_SIZE = 512;
export const PALETTE_ID = 2; // Universal Blue, only public palette
const MAX_AGE_MS = 120 * 60_000;

export function tilePoint(lon, lat, zoom = ZOOM) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85.051129) throw new Error('Bad map coordinates');
  const scale = 2 ** zoom;
  return {
    x: (lon + 180) / 360 * scale,
    y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale,
  };
}

export function tileCoordinates(bounds = REGION) {
  const a = tilePoint(bounds.west, bounds.north);
  const b = tilePoint(bounds.east, bounds.south);
  const tiles = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) {
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) tiles.push({ x, y });
  }
  // Grafton/Northern Rivers is a small fixed region. More than nine tiles indicates
  // an accidental scope/configuration change and is not safe for the free API.
  if (!tiles.length || tiles.length > 9) throw new Error('Unexpected number of radar tiles');
  return tiles;
}

export function selectFrames(index, now = Date.now(), count = 4) {
  if (!index || index.host !== TILE_HOST || !Array.isArray(index.radar?.past)) throw new Error('Unexpected RainViewer index');
  const chosen = new Map();
  for (const entry of index.radar.past) {
    const at = Number(entry?.time) * 1000;
    const path = entry?.path;
    if (!Number.isInteger(at) || at <= 0 || at > now + 5 * 60_000 || now - at > MAX_AGE_MS) continue;
    if (typeof path !== 'string' || !/^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(path)) continue;
    chosen.set(at, { capturedAt: at, path });
  }
  return [...chosen.values()].sort((a, b) => a.capturedAt - b.capturedAt).slice(-Math.min(4, Math.max(1, count)));
}

export function tileURL(path, { x, y }, host = TILE_HOST) {
  if (host !== TILE_HOST || !/^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(path)) throw new Error('Untrusted radar host or path');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** ZOOM || y >= 2 ** ZOOM) {
    throw new Error('Invalid radar tile coordinates');
  }
  return `${TILE_HOST}${path}/${TILE_SIZE}/${ZOOM}/${x}/${y}/${PALETTE_ID}/0_0.png`;
}

/**
 * Node's fetch reports every network-level failure as "fetch failed" and keeps the
 * reason (DNS, TLS, refused, redirect) in `cause`. Name the host and that reason, or a
 * failure on a deployed collector cannot be diagnosed from its log.
 */
export function describeFetchError(url, error) {
  let host = 'RainViewer';
  try { host = new URL(url).host; } catch { /* keep the generic name */ }
  if (error?.name === 'TimeoutError') return `${host}: no answer within 12 s`;
  const message = error instanceof Error ? error.message : String(error);
  const cause = error?.cause;
  const detail = cause ? [cause.code, cause.message].filter(Boolean).join(' ') : '';
  return `${host}: ${message}${detail ? ` (${detail})` : ''}`;
}
