import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { assertTransparentOverlay, colourGridFromRGBA, decodePng, radarGrid } from './png-grid.mjs';

function chunk(name, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0); b.write(name, 4); data.copy(b, 8);
  return b; // decoder doesn't need a CRC; actual downloaded PNGs include one
}
function makePng(opaque = false) {
  const h = Buffer.alloc(13); h.writeUInt32BE(64, 0); h.writeUInt32BE(64, 4);
  h[8] = 8; h[9] = 3;
  const scanlines = Buffer.alloc(65 * 64);
  for (let y = 0; y < 64; y++) {
    const offset = y * 65;
    scanlines[offset] = 0;
    if (opaque) scanlines.fill(1, offset + 1, offset + 65);
    else if (y === 20) scanlines[21 + offset] = 1;
  }
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([sig, chunk('IHDR', h), chunk('PLTE', Buffer.from([0,0,0,70,205,90])),
    chunk('tRNS', Buffer.from([0,255])), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
test('decodes an indexed transparent PNG into real coloured cells', () => {
  const decoded = decodePng(makePng());
  assert.equal(decoded.width, 64);
  const frame = radarGrid(makePng());
  assert.ok(frame.occupied >= 1);
  assert.equal(frame.palette[0], '46cd5a');
  assert.equal(Buffer.from(frame.grid, 'base64').length, 6400);
  assert.ok(Buffer.from(frame.grid, 'base64').includes(1));
});
test('rejects a map background instead of showing false radar', () => {
  assert.throws(() => radarGrid(makePng(true)), /no transparent pixels/);
});
test('keeps widespread rain that covers almost the whole sampled region', () => {
  // 63 of 64 columns are rain: far beyond the 80% that used to be refused as a
  // background, yet the tile is still an overlay because one column is transparent.
  const rgba = Buffer.alloc(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p++) if (p % 64 !== 0) rgba.set([70, 205, 90, 255], p * 4);
  assert.doesNotThrow(() => assertTransparentOverlay(rgba));
  const frame = colourGridFromRGBA({ width: 64, height: 64, rgba });
  assert.ok(frame.occupied > 80 * 80 * 0.95);
});
test('rejects malformed images instead of fabricating readings', () => {
  assert.throws(() => radarGrid(Buffer.from('not a png')), /Not a PNG/);
});
