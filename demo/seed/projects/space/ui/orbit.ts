export function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
export function wrapLon(lon: number) { var x = lon; while (x > 180)
    x -= 360; while (x < -180)
    x += 360; return x; }
// ISS ground-track geometry for a circular orbit. The previous track was a rough
// stand-in: latitude as inc*sin(phase) (up to 3 deg out) and a hardcoded 9.3 deg of
// longitude per step, when the true step runs from 5.3 deg at the equator to 14.4
// deg near the turning points. Worse, the orbital phase came from asin(lat/inc),
// which only ever returns the ascending quadrant, so the track was drawn heading
// north-east even while the station was descending — wrong about half the time.
// These use the actual spherical relations instead.
export const ISS_INC = 51.64, EARTH_ROT_DEG_S = 360 / 86164, EARTH_MU = 398600.4418, EARTH_R = 6371;
// Deliberately asymmetric and well under one orbit, in minutes, one sample per minute.
// A span close to the 93 min period brings the two ends back around near each other,
// which reads as a broken loop even though the path is continuous and its ends are
// simply two different times. Measured worst-case separation of the two far ends,
// sampled around the orbit: 92 min total leaves 2,091 km; 90 min leaves 2,907 km; 70 min
// leaves 11,070 km. At three quarters of an orbit the arc is unmistakably an open path,
// and showing more ahead than behind makes the direction of travel obvious.
export const TRACK_PAST_MIN = 20, TRACK_FUTURE_MIN = 50;
// Kepler's third law on the altitude the API reports, so the period tracks the real
// orbit (which decays and gets reboosted) instead of being frozen in a constant.
export function issPeriodS(altKm: number) { const a = EARTH_R + (Number.isFinite(altKm) && altKm > 0 ? altKm : 420); return 2 * Math.PI * Math.sqrt(a * a * a / EARTH_MU); }
export function issLat(uDeg: number) { const R = Math.PI / 180; return Math.asin(Math.sin(ISS_INC * R) * Math.sin(uDeg * R)) / R; }
export function issNode(uDeg: number) { const R = Math.PI / 180; return Math.atan2(Math.cos(ISS_INC * R) * Math.sin(uDeg * R), Math.cos(uDeg * R)) / R; }
// Argument of latitude from a latitude, disambiguated by the branch the Logic derived.
export function issPhase(latDeg: number, ascending: boolean) { const R = Math.PI / 180; const u = Math.asin(clamp(Math.sin(latDeg * R) / Math.sin(ISS_INC * R), -1, 1)) / R; return ascending ? u : 180 - u; }
// Advance the subsatellite point by dtSeconds (negative to step back). Longitude
// gains the change in orbital node and loses Earth's rotation over the same interval.
// Longitude stays CONTINUOUS (unwrapped) through stepping and track building, so the
// antimeridian can be handled exactly once, at draw time, by issSegments. Wrapping
// earlier is what left a visible gap: consecutive points sit 5-14 deg apart, so a
// polyline merely split on a large x jump stopped several pixels short of one map edge
// and resumed several pixels inside the other.
export function issStep(u0: number, lon0: number, dtSeconds: number, periodS: number) { const u = u0 + (dtSeconds / periodS) * 360; let dn = issNode(u) - issNode(u0); while (dn > 180)
    dn -= 360; while (dn < -180)
    dn += 360; return { u: u, lat: issLat(u), lon: lon0 + dn - EARTH_ROT_DEG_S * dtSeconds }; }
// One arc in a single time direction, always returned in chronological order and
// always including the current fix, so the past and future halves meet at the marker.
// dir = -1 walks backwards in time, +1 forwards.
export function issArc(u0: number, lon0: number, periodS: number, stepS: number, steps: number, dir: number) { const pts = [{ lat: issLat(u0), lon: lon0 }]; let u = u0, lon = lon0; for (let s = 1; s <= steps; s++) {
    const n = issStep(u, lon, dir * stepS, periodS);
    u = n.u;
    lon = n.lon;
    pts.push({ lat: n.lat, lon: n.lon });
} return dir < 0 ? pts.reverse() : pts; }
export function issTrack(u0: number, lon0: number, periodS: number, stepS: number, steps: number) { return issArc(u0, lon0, periodS, stepS, steps, -1).concat(issArc(u0, lon0, periodS, stepS, steps, 1).slice(1)); }
// Project an arc into SVG polyline point strings, one per antimeridian-split segment.
export function issPolylines(pts: {
    lat: number;
    lon: number;
}[], px: (lon: number) => number, py: (lat: number) => number) { return issSegments(pts).map(function (seg) { return seg.map(function (p) { return px(p.lon).toFixed(1) + "," + py(p.lat).toFixed(1); }).join(" "); }); }
// Split a continuous-longitude track into polylines at each +/-180 boundary, ending one
// piece exactly ON the edge and resuming the next exactly on the opposite edge at the
// same latitude. The track advances at most ~15 deg per step, so a step crosses at most
// one boundary.
export function issSegments(pts: {
    lat: number;
    lon: number;
}[]) { const segs: {
    lat: number;
    lon: number;
}[][] = []; let cur: {
    lat: number;
    lon: number;
}[] = []; for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
        const q = pts[i - 1], p = pts[i], lo = Math.min(q.lon, p.lon), hi = Math.max(q.lon, p.lon), L = 180 + 360 * Math.ceil((lo - 180) / 360);
        if (p.lon !== q.lon && L > lo && L <= hi) {
            const f = (L - q.lon) / (p.lon - q.lon), lat = q.lat + f * (p.lat - q.lat), east = p.lon > q.lon;
            cur.push({ lat: lat, lon: east ? 180 : -180 });
            segs.push(cur);
            cur = [{ lat: lat, lon: east ? -180 : 180 }];
        }
    }
    cur.push(pts[i]);
} segs.push(cur); return segs.filter(function (s) { return s.length > 1; }); }
