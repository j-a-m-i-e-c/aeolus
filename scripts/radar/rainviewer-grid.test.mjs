import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { REGION, tileCoordinates, tilePoint } from './rainviewer-api.mjs';
import { regionalRadarGrid } from './rainviewer-grid.mjs';
function chunk(name, bytes) {
  const b = Buffer.alloc(bytes.length + 12);
  b.writeUInt32BE(bytes.length, 0); b.write(name,4); bytes.copy(b,8); return b;
}
function pngAt(point) {
  const n = 512;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n,0); ihdr.writeUInt32BE(n,4); ihdr[8]=8; ihdr[9]=6;
  const rows = Buffer.alloc((n*4+1)*n);
  if (point) {
    const {px,py} = point;
    for(let y=Math.max(0,py-14); y<Math.min(n,py+14); y++)
      for(let x=Math.max(0,px-14); x<Math.min(n,px+14); x++) {
        const offset = (n*4+1)*y+1+x*4;
        rows[offset]=11; rows[offset+1]=96; rows[offset+2]=255; rows[offset+3]=255;
      }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
test('coloured RainViewer tile pixels land in the proper region on the SVG grid', () => {
  const target = tilePoint(153.1,-28.8);
  const px = Math.floor((target.x-Math.floor(target.x))*512);
  const py = Math.floor((target.y-Math.floor(target.y))*512);
  const tiles = new Map(tileCoordinates(REGION).map((t)=>[`${t.x},${t.y}`, pngAt(t.x===Math.floor(target.x)&&t.y===Math.floor(target.y) ? {px,py}:null)]));
  const grid = regionalRadarGrid(tiles);
  assert.deepEqual(grid.bounds, [152,-30.2,154.2,-27.7]);
  assert.deepEqual(grid.palette,['0b60ff']);
  assert.ok(grid.occupied>0 && grid.occupied<200);
  assert.equal(Buffer.from(grid.grid,'base64').length,6400);
  assert.throws(()=>regionalRadarGrid(new Map()), /Missing required radar tile/);
});
