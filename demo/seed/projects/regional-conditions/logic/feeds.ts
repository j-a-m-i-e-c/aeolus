// Shared plumbing for the public feeds this automation reads.

// The map frame, WGS84. Wide enough for the Tweed, Brunswick, Richmond and Clarence
// catchments; the UI draws exactly this rectangle.
export const MAP_BOUNDS = { west: 152, east: 154.2, south: -30.2, north: -27.7 };

export function withinMap(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= MAP_BOUNDS.west && lon <= MAP_BOUNDS.east
    && lat >= MAP_BOUNDS.south && lat <= MAP_BOUNDS.north;
}

/**
 * GET a public feed and return its body, or throw a short reason a person can read.
 *
 * `http.get` never rejects. A request the outbound policy refuses, or one that times out
 * or exceeds the response cap, resolves with status 0 and the reason as the body, so the
 * status has to be checked before the body is treated as data. Without that, a timeout
 * surfaced as "Unexpected token R in JSON".
 */
export async function fetchFeed(url: string, headers?: Record<string, string>): Promise<string> {
  const response = await http.get(url, headers ? { headers } : undefined);
  if (response.status === 0) throw new Error(plain(response.body) || 'Request failed');
  if (response.status === 408) throw new Error('Source did not answer in time (HTTP 408)');
  if (response.status < 200 || response.status > 299) throw new Error('Source answered HTTP ' + response.status);
  return response.body;
}

/** Parse JSON with a readable failure instead of the engine's token message. */
export function parseJson(raw: string, source: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(source + ' sent something other than JSON');
  }
}

export function reason(error: unknown): string {
  return plain((error as Error)?.message ?? error) || 'Unknown error';
}

/** Feed text is untrusted: bound it, and strip any markup before it reaches a pane. */
export function plain(value: unknown, max = 120): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
