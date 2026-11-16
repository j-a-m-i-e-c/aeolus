// WaterNSW monitoring stations inside the map, from the live Hydstra catalogue.
//
// Fixed rather than discovered at run time. The catalogue calls (get_site_geojson per basin,
// then get_variable_list) took 7–18 s each when this was generated, and outbound requests
// from an automation stop at 10 s, so discovery would fail on most runs and cost the public
// service two extra heavy requests every ten minutes. Stations change rarely; regenerate
// this file from the same two calls when they do.
//
// level: reports stream water level (variable 100.00, metres).
// rain:  reports rainfall (variable 10.00, millimetres).
// Captured 2026-11-16: 71 active stations in bounds; 52 level, 19 rain.

export interface Station {
  id: string;
  name: string;
  lon: number;
  lat: number;
  level: boolean;
  rain: boolean;
}

export const STATIONS: Station[] = [
  { id: "201001", name: "Oxley River at Eungella", lon: 153.2929, lat: -28.3540, level: true, rain: true },
  { id: "201005", name: "Rous River at Boat Harbour No.3", lon: 153.3359, lat: -28.3096, level: true, rain: false },
  { id: "201012", name: "Cobaki Creek at Cobaki", lon: 153.4589, lat: -28.2009, level: true, rain: false },
  { id: "201015", name: "Tweed River d/s Palmers Road Crossing", lon: 153.2922, lat: -28.4340, level: true, rain: false },
  { id: "201900", name: "Tweed River at Uki", lon: 153.3349, lat: -28.4135, level: true, rain: true },
  { id: "202001", name: "Brunswick River at Durrumbul (Sherrys Crossing)", lon: 153.4582, lat: -28.5312, level: true, rain: false },
  { id: "202002", name: "Burringbar Creek at Burringbar", lon: 153.4768, lat: -28.4378, level: true, rain: false },
  { id: "203002", name: "Coopers Creek at Repentance", lon: 153.4126, lat: -28.6413, level: true, rain: true },
  { id: "203004", name: "Richmond River at Casino", lon: 153.0554, lat: -28.8640, level: true, rain: false },
  { id: "203005", name: "Richmond River at Wiangaree", lon: 152.9671, lat: -28.5055, level: true, rain: true },
  { id: "203010", name: "Leycester River at Rock Valley", lon: 153.1632, lat: -28.7364, level: true, rain: true },
  { id: "203012", name: "Byron Creek at Binna Burra", lon: 153.4979, lat: -28.7066, level: true, rain: false },
  { id: "203014", name: "Wilsons River at Eltham", lon: 153.3948, lat: -28.7556, level: true, rain: false },
  { id: "203023", name: "Ironpot Creek at Toonumbar", lon: 152.7985, lat: -28.6231, level: true, rain: false },
  { id: "203024", name: "Coopers Creek at Ewing Bridge", lon: 153.3623, lat: -28.7215, level: true, rain: true },
  { id: "203030", name: "Myrtle Creek at Rappville", lon: 152.9994, lat: -29.1100, level: true, rain: true },
  { id: "203034", name: "Eden Creek at Doubtful", lon: 152.9240, lat: -28.7569, level: true, rain: true },
  { id: "203041", name: "Shannon Brook at Yorklea", lon: 153.0062, lat: -28.9403, level: true, rain: true },
  { id: "203042", name: "Ironpot Creek at Toonumbar Dam-Storage Gauge", lon: 152.7936, lat: -28.6185, level: false, rain: true },
  { id: "203056", name: "Richmond River at Lavelles Road", lon: 152.8916, lat: -28.4504, level: true, rain: false },
  { id: "203057", name: "Houghlahans Creek at Upstream Teven", lon: 153.4948, lat: -28.8012, level: true, rain: false },
  { id: "203059", name: "Marom Creek at Graham Road", lon: 153.3674, lat: -28.8749, level: true, rain: false },
  { id: "203060", name: "Coopers Creek at Fairmeadow", lon: 153.3517, lat: -28.7460, level: true, rain: false },
  { id: "203061", name: "Goolmangar Creek at Mcnamara Bridge Weir", lon: 153.2256, lat: -28.7331, level: true, rain: false },
  { id: "203062", name: "Wilsons River at Lavertys Gap Weir", lon: 153.4385, lat: -28.5762, level: true, rain: false },
  { id: "203403", name: "Richmond River at Coraki", lon: 153.2896, lat: -28.9900, level: true, rain: false },
  { id: "203470", name: "Richmond Rv @ Oakland Road", lon: 153.2739, lat: -29.0071, level: true, rain: false },
  { id: "203900", name: "Richmond River at Kyogle", lon: 152.9948, lat: -28.6210, level: true, rain: true },
  { id: "204001", name: "Nymboida River at Nymboida", lon: 152.7250, lat: -29.9793, level: true, rain: true },
  { id: "204002", name: "Clarence River at Tabulam", lon: 152.5675, lat: -28.8868, level: true, rain: true },
  { id: "204004", name: "Mann River at Jackadgery", lon: 152.5449, lat: -29.5714, level: true, rain: false },
  { id: "204006", name: "Bookookoorara River at Undercliffe", lon: 152.1695, lat: -28.6446, level: true, rain: false },
  { id: "204007", name: "Clarence River at Lilydale (Newbold Crossing)", lon: 152.6834, lat: -29.5073, level: true, rain: true },
  { id: "204014", name: "Mann River at Mitchell", lon: 152.1060, lat: -29.6931, level: true, rain: false },
  { id: "204015", name: "Boyd River at Broadmeadows", lon: 152.3171, lat: -29.8394, level: true, rain: false },
  { id: "204033", name: "Timbarra River at Billyrimba", lon: 152.2512, lat: -29.1928, level: true, rain: true },
  { id: "204034", name: "Henry River at Newton Boyd", lon: 152.2145, lat: -29.7613, level: true, rain: false },
  { id: "204036", name: "Cataract Creek at Sandy Hill(Below Snake Creek)", lon: 152.2182, lat: -28.9325, level: true, rain: true },
  { id: "204037", name: "Clouds Creek at Clouds Creek", lon: 152.6293, lat: -30.0922, level: true, rain: false },
  { id: "204039", name: "Maryland River d/s Wylie Creek", lon: 152.1988, lat: -28.4663, level: true, rain: false },
  { id: "204041", name: "Orara River at Bawden Bridge", lon: 152.8099, lat: -29.7217, level: true, rain: false },
  { id: "204043", name: "Peacock Creek at Bonalbo", lon: 152.6747, lat: -28.7329, level: true, rain: false },
  { id: "204046", name: "Timbarra River at Drake", lon: 152.3861, lat: -29.0547, level: true, rain: false },
  { id: "204051", name: "Clarence River at Paddys Flat", lon: 152.4198, lat: -28.7198, level: true, rain: false },
  { id: "204055", name: "Sportsmans Creek at Gurranang Siding", lon: 152.9827, lat: -29.4652, level: true, rain: false },
  { id: "204056", name: "Dandahra Creek at Gibraltar Range", lon: 152.4468, lat: -29.4848, level: true, rain: false },
  { id: "204067", name: "Gordon Brook at Fineflower", lon: 152.6539, lat: -29.4016, level: true, rain: false },
  { id: "204069", name: "Nymboida River d/s Nymboida Weir", lon: 152.6861, lat: -29.9216, level: true, rain: false },
  { id: "204400", name: "Clarence River at Grafton", lon: 152.9318, lat: -29.6936, level: true, rain: false },
  { id: "204403", name: "Coldstream River at Tucabia", lon: 153.1052, lat: -29.6666, level: true, rain: true },
  { id: "204413", name: "Clarence River at Rogans Bridge", lon: 152.8844, lat: -29.6191, level: true, rain: false },
  { id: "204900", name: "Clarence River at Baryulgil", lon: 152.5932, lat: -29.1961, level: true, rain: true },
  { id: "204906", name: "Orara River at Glenreagh", lon: 152.9853, lat: -30.0676, level: true, rain: true },
];

export const LEVEL_STATIONS = STATIONS.filter((station) => station.level);
export const RAIN_STATIONS = STATIONS.filter((station) => station.rain);
