import { assertTransparentOverlay, colourGridFromRGBA, decodePng } from './png-grid.mjs';
import { REGION, TILE_SIZE, tilePoint } from './rainviewer-api.mjs';

// Convert downloaded tiles to one geographically accurate 80x80 raster.
// Sample each target cell using Web Mercator, then let Aeolus draw the cells
// against its own geographic projection. No images, iframes or tile URLs enter UI.
export function regionalRadarGrid(tileImages, bounds = REGION) {
  const decoded = new Map();
  for (const [key, png] of tileImages) {
    if (!/^\d+,\d+$/.test(key)) throw new Error('Invalid tile key');
    const tile = decodePng(png);
    if (tile.width !== TILE_SIZE || tile.height !== TILE_SIZE) throw new Error('Unexpected radar tile dimensions');
    assertTransparentOverlay(tile.rgba);
    decoded.set(key, tile.rgba);
  }
  const size = 80;
  const raster = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const lon = bounds.west + (x + .5) / size * (bounds.east - bounds.west);
    const lat = bounds.north - (y + .5) / size * (bounds.north - bounds.south);
    const map = tilePoint(lon, lat);
    const tx = Math.floor(map.x), ty = Math.floor(map.y);
    const pixels = decoded.get(`${tx},${ty}`);
    if (!pixels) throw new Error('Missing required radar tile');
    const px = Math.min(TILE_SIZE - 1, Math.floor((map.x - tx) * TILE_SIZE));
    const py = Math.min(TILE_SIZE - 1, Math.floor((map.y - ty) * TILE_SIZE));
    pixels.copy(raster, (y * size + x) * 4, (py * TILE_SIZE + px) * 4, (py * TILE_SIZE + px + 1) * 4);
  }
  return { ...colourGridFromRGBA({ width: size, height: size, rgba: raster }),
    bounds: [bounds.west, bounds.south, bounds.east, bounds.north] };
}
