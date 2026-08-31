// Space real-data source implementation. logic/index.ts shows the refresh schedule.
function round(value: unknown, precision = 0) {
    const number = Number(value);
    if (!isFinite(number))
        return null;
    const multiplier = Math.pow(10, precision);
    return Math.round(number * multiplier) / multiplier;
}
function latestRow(table: unknown) {
    return Array.isArray(table) && table.length > 1 ? table[table.length - 1] : null;
}
function rowValue(headers: unknown, row: any, name: string) {
    const index = Array.isArray(headers) ? headers.indexOf(name) : -1;
    return index >= 0 && row ? row[index] : null;
}
export async function updateIss(now: number) {
    try {
        const response = await http.get("https://api.wheretheiss.at/v1/satellites/25544");
        const iss = JSON.parse(response.body);
        // A single fix cannot distinguish ascending from descending; compare fixes
        // and hold the previous branch through the orbital turning point.
        const previous = state.get("iss");
        const previousLat = previous && typeof previous.lat === "number" ? Number(previous.lat) : null;
        let ascending = state.get("issAscending");
        if (previousLat !== null && Math.abs(iss.latitude - previousLat) > 0.05) {
            ascending = iss.latitude > previousLat;
        }
        if (ascending !== true && ascending !== false)
            ascending = true;
        state.set("issAscending", Boolean(ascending));
        state.set("iss", {
            lat: round(iss.latitude, 2),
            lon: round(iss.longitude, 2),
            altKm: Math.round(iss.altitude),
            velKmh: Math.round(iss.velocity),
            visibility: iss.visibility || "",
        });
        state.set("issUpdated", now);
        try {
            if (db)
                db.write("iss-track", { lat: iss.latitude, lon: iss.longitude, alt: iss.altitude });
        }
        catch (error) {
            // History is optional; live telemetry remains available without it.
        }
    }
    catch (error) {
        log.warn("ISS fetch failed: " + error.message);
    }
}
export async function updateLaunches(now: number) {
    const updatedAt = Number(state.get("launchesUpdated")) || 0;
    if (now - updatedAt <= 1800000)
        return;
    try {
        const response = await http.get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=6&mode=list");
        const data = JSON.parse(response.body);
        state.set("launches", (data.results || []).map((launch: any) => ({
            name: launch.name,
            net: launch.net,
            provider: (launch.launch_service_provider || {}).name || "",
            pad: (launch.pad || {}).name || "",
        })));
        state.set("launchesUpdated", now);
    }
    catch (error) {
        log.warn("Launch feed failed: " + error.message);
    }
}
async function updateKp() {
    try {
        const response = await http.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
        const rows = JSON.parse(response.body);
        if (rows && rows.length > 1)
            state.set("kp", Number(rows[rows.length - 1][1]));
    }
    catch (error) {
        log.warn("Kp fetch failed: " + error.message);
    }
}
async function updateSolarWind() {
    try {
        const response = await http.get("https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json");
        const rows = JSON.parse(response.body);
        const headers = rows[0] || [];
        const row = latestRow(rows);
        state.set("solarWind", {
            speed: round(rowValue(headers, row, "speed"), 0),
            bz: round(rowValue(headers, row, "bz"), 1),
            density: round(rowValue(headers, row, "density"), 1),
            arrival: rowValue(headers, row, "propagated_time_tag") || rowValue(headers, row, "time_tag") || "",
        });
    }
    catch (error) {
        log.warn("Solar wind fetch failed: " + error.message);
    }
}
async function updateLatestFlare() {
    try {
        const response = await http.get("https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json");
        const flares = JSON.parse(response.body);
        const flare = Array.isArray(flares) && flares.length ? flares[flares.length - 1] : null;
        if (flare) {
            state.set("flare", {
                className: flare.max_class || flare.begin_class || "",
                peak: flare.max_time || flare.time_tag || "",
                satellite: flare.satellite || "",
            });
        }
    }
    catch (error) {
        log.warn("GOES flare fetch failed: " + error.message);
    }
}
async function updateAurora() {
    try {
        const response = await http.get("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
        const aurora = JSON.parse(response.body);
        const coordinates = aurora.coordinates || [];
        const candidates: any[] = [];
        let maxProbability = 0;
        for (let index = 0; index < coordinates.length; index += 1) {
            const point = coordinates[index];
            const probability = Number(point[2]) || 0;
            if (probability > maxProbability)
                maxProbability = probability;
            if (probability < 6)
                continue;
            let longitude = Number(point[0]);
            if (longitude > 180)
                longitude -= 360;
            candidates.push([round(longitude, 0), round(Number(point[1]), 0), round(probability, 0)]);
        }
        candidates.sort((a, b) => b[2] - a[2]);
        const selected: any[] = [];
        const used: Record<string, number> = {};
        for (let index = 0; index < candidates.length && selected.length < 96; index += 1) {
            const point = candidates[index];
            const key = Math.round(point[0] / 6) + ":" + Math.round(point[1] / 3);
            if (!used[key]) {
                used[key] = 1;
                selected.push(point);
            }
        }
        state.set("aurora", {
            max: round(maxProbability, 0),
            forecastTime: aurora["Forecast Time"] || "",
            points: selected,
        });
    }
    catch (error) {
        log.warn("Aurora fetch failed: " + error.message);
    }
}
export async function updateSpaceWeather(now: number) {
    const updatedAt = Number(state.get("wxUpdated")) || 0;
    if (now - updatedAt <= 900000)
        return;
    await updateKp();
    await updateSolarWind();
    await updateLatestFlare();
    await updateAurora();
    state.set("wxUpdated", now);
}
export async function updateMoon(now: number) {
    const updatedAt = Number(state.get("moonUpdated")) || 0;
    if (now - updatedAt <= 21600000)
        return;
    const day = new Date(now).toISOString().slice(0, 10);
    try {
        const response = await http.get("https://aa.usno.navy.mil/api/rstt/oneday?date=" + day + "&coords=0,0&tz=0");
        const data = JSON.parse(response.body);
        const body = (((data || {}).properties || {}).data || {});
        state.set("moon", {
            phase: body.curphase || "",
            illumination: body.fracillum || "",
            closest: body.closestphase || null,
        });
    }
    catch (error) {
        log.warn("Moon data fetch failed: " + error.message);
    }
    try {
        const response = await http.get("https://aa.usno.navy.mil/api/moon/phases/date?date=" + day + "&nump=4");
        const data = JSON.parse(response.body);
        state.set("moonPhases", (data.phasedata || []).slice(0, 4));
    }
    catch (error) {
        log.warn("Moon phase fetch failed: " + error.message);
    }
    state.set("moonUpdated", now);
}
