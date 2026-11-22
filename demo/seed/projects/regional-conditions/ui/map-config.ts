// Region-specific geography for the map. The renderer and the radar layer read these
// values; ui/coastline.ts and ui/rivers.ts are generated for the same bounds, and the
// Logic (logic/radar.ts, logic/feeds.ts) checks the same frame on its side.
export const MAP_BOUNDS = { west: 152, east: 154.2, south: -30.2, north: -27.7 };
export const MAP_NAME = 'NORTHERN RIVERS · NSW';
export const TOWNS: [string, number, number][] = [
  ['Tweed Heads', 153.54, -28.18], ['Murwillumbah', 153.40, -28.33], ['Byron Bay', 153.61, -28.65],
  ['Lismore', 153.28, -28.81], ['Ballina', 153.56, -28.87], ['Casino', 153.05, -28.86],
  ['Kyogle', 153.00, -28.62], ['Yamba', 153.36, -29.44], ['Grafton', 152.94, -29.69],
];
