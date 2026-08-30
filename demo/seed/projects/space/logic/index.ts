// space — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var now = Date.now();
      function round(v, p) { var n = Number(v); if (!isFinite(n)) return null; var m = Math.pow(10, p || 0); return Math.round(n * m) / m; }
      function latestRow(table) { return Array.isArray(table) && table.length > 1 ? table[table.length - 1] : null; }
      function rowValue(headers, row, name) { var i = Array.isArray(headers) ? headers.indexOf(name) : -1; return i >= 0 && row ? row[i] : null; }

      try {
        var res = await http.get("https://api.wheretheiss.at/v1/satellites/25544");
        var iss = JSON.parse(res.body);
        // Which half of the orbit the station is on. A single fix cannot tell:
        // every latitude occurs twice per orbit, once climbing and once falling,
        // and the API reports no heading. Comparing consecutive fixes resolves it.
        // The branch is held through a turning point (where latitude barely moves)
        // so the reading only flips once the station is genuinely descending.
        var prevIss = state.get("iss");
        var prevLat = prevIss && typeof prevIss.lat === "number" ? Number(prevIss.lat) : null;
        var ascending = state.get("issAscending");
        if (prevLat !== null && Math.abs(iss.latitude - prevLat) > 0.05) ascending = iss.latitude > prevLat;
        if (ascending !== true && ascending !== false) ascending = true;
        state.set("issAscending", Boolean(ascending));
        state.set("iss", { lat: round(iss.latitude, 2), lon: round(iss.longitude, 2), altKm: Math.round(iss.altitude), velKmh: Math.round(iss.velocity), visibility: iss.visibility || "" });
        state.set("issUpdated", now);
        try { if (db) db.write("iss-track", { lat: iss.latitude, lon: iss.longitude, alt: iss.altitude }); } catch (e) {}
      } catch (e) { log.warn("ISS fetch failed: " + e.message); }

      var launchesAt = Number(state.get("launchesUpdated")) || 0;
      if (now - launchesAt > 1800000) {
        try {
          var lr = await http.get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=6&mode=list");
          var data = JSON.parse(lr.body);
          state.set("launches", (data.results || []).map(function (x) { return { name: x.name, net: x.net, provider: (x.launch_service_provider || {}).name || "", pad: ((x.pad || {}).name || "") }; }));
          state.set("launchesUpdated", now);
        } catch (e) { log.warn("Launch feed failed: " + e.message); }
      }

      var wxAt = Number(state.get("wxUpdated")) || 0;
      if (now - wxAt > 900000) {
        try {
          var wr = await http.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
          var arr = JSON.parse(wr.body);
          if (arr && arr.length > 1) { var last = arr[arr.length - 1]; state.set("kp", Number(last[1])); }
        } catch (e) { log.warn("Kp fetch failed: " + e.message); }
        try {
          var swr = await http.get("https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json");
          var sw = JSON.parse(swr.body), headers = sw[0] || [], row = latestRow(sw);
          state.set("solarWind", { speed: round(rowValue(headers,row,"speed"),0), bz: round(rowValue(headers,row,"bz"),1), density: round(rowValue(headers,row,"density"),1), arrival: rowValue(headers,row,"propagated_time_tag") || rowValue(headers,row,"time_tag") || "" });
        } catch (e) { log.warn("Solar wind fetch failed: " + e.message); }
        try {
          var fr = await http.get("https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json");
          var flares = JSON.parse(fr.body), flare = Array.isArray(flares) && flares.length ? flares[flares.length - 1] : null;
          if (flare) state.set("flare", { className: flare.max_class || flare.begin_class || "", peak: flare.max_time || flare.time_tag || "", satellite: flare.satellite || "" });
        } catch (e) { log.warn("GOES flare fetch failed: " + e.message); }
        try {
          var ar = await http.get("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
          var aur = JSON.parse(ar.body), coords = aur.coordinates || [], candidates = [], maxP = 0;
          for (var ai=0; ai<coords.length; ai++) { var c=coords[ai], av=Number(c[2])||0; if(av>maxP)maxP=av; if(av>=6){var lon=Number(c[0]);if(lon>180)lon-=360;candidates.push([round(lon,0),round(Number(c[1]),0),round(av,0)]);} }
          candidates.sort(function(a,b){return b[2]-a[2];});
          var selected=[], used={};
          for(var ci=0;ci<candidates.length&&selected.length<96;ci++){var cc=candidates[ci],key=Math.round(cc[0]/6)+":"+Math.round(cc[1]/3);if(!used[key]){used[key]=1;selected.push(cc);}}
          state.set("aurora", { max: round(maxP,0), forecastTime: aur["Forecast Time"] || "", points: selected });
        } catch (e) { log.warn("Aurora fetch failed: " + e.message); }
        state.set("wxUpdated", now);
      }

      var moonAt = Number(state.get("moonUpdated")) || 0;
      if (now - moonAt > 21600000) {
        var day = new Date(now).toISOString().slice(0,10);
        try {
          var mr = await http.get("https://aa.usno.navy.mil/api/rstt/oneday?date=" + day + "&coords=0,0&tz=0");
          var md = JSON.parse(mr.body), body = (((md || {}).properties || {}).data || {});
          state.set("moon", { phase: body.curphase || "", illumination: body.fracillum || "", closest: body.closestphase || null });
        } catch (e) { log.warn("Moon data fetch failed: " + e.message); }
        try {
          var pr = await http.get("https://aa.usno.navy.mil/api/moon/phases/date?date=" + day + "&nump=4");
          var pd = JSON.parse(pr.body);
          state.set("moonPhases", (pd.phasedata || []).slice(0,4));
        } catch (e) { log.warn("Moon phase fetch failed: " + e.message); }
        state.set("moonUpdated", now);
      }
}
