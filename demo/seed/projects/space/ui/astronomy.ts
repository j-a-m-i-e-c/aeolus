// Subsolar point from UTC — the low-precision solar position algorithm of the
// Astronomical Almanac. Deterministic, no network, accurate to well under a tenth
// of a degree, which is far beyond what a 480px-wide map can show. Returns the
// latitude (solar declination) and longitude where the sun is directly overhead.
export function subsolar(nowMs: number) { const RAD = Math.PI / 180; const d = (nowMs - Date.UTC(2000, 0, 1, 12)) / 86400000; const L = (280.460 + 0.9856474 * d) % 360; const g = ((357.528 + 0.9856003 * d) % 360) * RAD; const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; const eps = (23.439 - 0.0000004 * d) * RAD; const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / RAD; const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD; const gmst = (280.46061837 + 360.98564736629 * d) % 360; return { lat: dec, lon: ((ra - gmst) % 360 + 540) % 360 - 180 }; }
// The night hemisphere on the same equirectangular projection as the map. Solar
// elevation is sin(elev)=sin(lat)sin(dec)+cos(lat)cos(dec)cos(H); solving for
// elev=0 gives the terminator latitude lat=atan(-cos(H)/tan(dec)) at each
// longitude H. Night is the side holding the pole tilted away from the sun, so the
// curve is closed to whichever map edge that is. Near an equinox tan(dec) tends to
// zero and the terminator becomes a pair of meridians, which the clamp reproduces.
export function nightShape(sub: {
    lat: number;
    lon: number;
}) { const RAD = Math.PI / 180; const px = (lon: number) => ((lon + 180) / 360) * 480, py = (lat: number) => 18 + ((90 - Math.max(-90, Math.min(90, lat))) / 180) * 240; let t = Math.tan(sub.lat * RAD); if (Math.abs(t) < 1e-6)
    t = t < 0 ? -1e-6 : 1e-6; const pts: string[] = []; for (let lon = -180; lon <= 180; lon += 2) {
    const H = (lon - sub.lon) * RAD;
    pts.push(px(lon).toFixed(2) + " " + py(Math.atan(-Math.cos(H) / t) / RAD).toFixed(2));
} const edge = (t > 0 ? py(-90) : py(90)).toFixed(2); return { area: "M" + pts.join(" L") + " L480 " + edge + " L0 " + edge + " Z", line: "M" + pts.join(" L") }; }
