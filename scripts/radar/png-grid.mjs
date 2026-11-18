// Decode bounded 8-bit, non-interlaced radar PNGs for ingestion outside the UI.
// This deliberately rejects formats we cannot decode safely rather than fabricating
// rainfall pixels. It retains each colour, NOT an invented mm/h conversion.
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette = null, alpha = null;
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > 16_000_000 || offset + length + 12 > bytes.length) throw new Error('Invalid PNG chunk');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'PLTE') palette = Buffer.from(data);
    else if (kind === 'tRNS') alpha = Buffer.from(data);
    else if (kind === 'IDAT') chunks.push(data);
    else if (kind === 'IEND') break;
    offset += length + 12;
  }
  if (width < 64 || width > 2048 || height !== width || depth !== 8 || interlace !== 0 || ![2, 3, 6].includes(type)) {
    throw new Error(`Unsupported PNG format ${width}x${height}, depth=${depth}, colour=${type}, interlace=${interlace}`);
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 1;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected PNG scanline length');
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), at = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const row = Buffer.from(raw.subarray(at, at + stride)); at += stride;
    for (let j = 0; j < stride; j++) {
      const left = j >= bpp ? row[j - bpp] : 0;
      const up = prev[j];
      const diagonal = j >= bpp ? prev[j - bpp] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, diagonal) : null;
      if (prediction === null) throw new Error('Invalid PNG filter');
      row[j] = (row[j] + prediction) & 255;
    }
    for (let x = 0; x < width; x++) {
      const src = x * bpp, dst = (y * width + x) * 4;
      if (type === 3) {
        const id = row[src];
        if (!palette || (id * 3 + 2) >= palette.length) throw new Error('Invalid PNG palette');
        rgba[dst] = palette[id * 3]; rgba[dst + 1] = palette[id * 3 + 1]; rgba[dst + 2] = palette[id * 3 + 2];
        rgba[dst + 3] = alpha?.[id] ?? 255;
      } else {
        rgba[dst] = row[src]; rgba[dst + 1] = row[src + 1]; rgba[dst + 2] = row[src + 2];
        rgba[dst + 3] = type === 6 ? row[src + 3] : 255;
      }
    }
    prev = row;
  }
  return { width, height, rgba };
}

export function colourGridFromRGBA({ width, height, rgba }, size = 80) {
  if (size !== 80) throw new Error('Radar grid must be 80 x 80');
  if (rgba.length !== width * height * 4 || width < 64 || height < 64) throw new Error('Invalid RGBA raster');
  const colours = new Map();
  const sampled = [];
  let opaque = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Preserve radar colours. They are reflectivity classes, not rainfall in mm/h.
    const sx = Math.floor((x + .5) * width / size), sy = Math.floor((y + .5) * height / size);
    const i = (sy * width + sx) * 4;
    const rgb = rgba.subarray(i, i + 3).toString('hex');
    const visible = rgba[i + 3] >= 128;
    if (visible) { opaque++; colours.set(rgb, (colours.get(rgb) ?? 0) + 1); }
    sampled.push(visible ? rgb : null);
  }
  const palette = [...colours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c]) => c);
  const index = new Map(palette.map((c, i) => [c, i + 1]));
  const toRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgbPalette = palette.map(toRgb);
  const grid = Buffer.from(sampled.map((color) => {
    if (!color) return 0;
    if (index.has(color)) return index.get(color);
    const [r, g, b] = toRgb(color);
    let best = 0, dist = Infinity;
    rgbPalette.forEach(([pr, pg, pb], i) => {
      const d = (r - pr)**2 + (g - pg)**2 + (b - pb)**2;
      if (d < dist) { dist = d; best = i + 1; }
    });
    return best;
  }));
  return { size, palette, grid: grid.toString('base64'), occupied: opaque };
}

/**
 * Only transparent precipitation overlays are acceptable: an opaque background image
 * would hide the map and might carry location marks instead of weather data.
 *
 * This is checked on whole source tiles, not on the sampled grid. Widespread rain can
 * legitimately cover most or all of the 80 x 80 region, which is exactly when radar is
 * worth showing, but a radar overlay tile still has transparent pixels somewhere.
 */
export function assertTransparentOverlay(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) return;
  throw new Error('PNG has no transparent pixels; expected a radar overlay, not a map background');
}

export function radarGrid(png, size = 80) {
  const decoded = decodePng(png);
  assertTransparentOverlay(decoded.rgba);
  return colourGridFromRGBA(decoded, size);
}
