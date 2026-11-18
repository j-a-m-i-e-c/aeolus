import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION, ZOOM, describeFetchError, tileCoordinates, tilePoint, tileURL, selectFrames } from './rainviewer-api.mjs';

test('northern rivers spans exactly two z7 tiles, with correct Web Mercator geometry', () => {
  assert.equal(ZOOM, 7);
  assert.deepEqual(tileCoordinates(REGION), [{ x: 118, y: 74 }, { x: 118, y: 75 }]);
  const northern = tilePoint(153, -28);
  const southern = tilePoint(153, -30);
  assert.ok(northern.y < southern.y);
});
test('RainViewer API frames are filtered, ordered and limited to four', () => {
  const now = 1_800_000_000_000;
  const time = Math.floor(now / 1000);
  const frames = Array.from({length: 9}, (_, i) => ({time: time - (8 - i) * 600, path: `/v2/radar/frame_${i}`}));
  const list = selectFrames({host:'https://tilecache.rainviewer.com', radar:{past:[...frames,
    { time: time + 1800, path: '/v2/radar/future' }, { time, path: '/v2/radar/../attack' }] }}, now);
  assert.equal(list.length, 4);
  assert.equal(list[0].capturedAt, now - 30 * 60000);
  assert.equal(list.at(-1).path, '/v2/radar/frame_8');
});
test('rejects arbitrary hosts or paths and creates a fixed tile URL', () => {
  const frame = {host:'https://evil.example',radar:{past:[]}};
  assert.throws(() => selectFrames(frame), /Unexpected/);
  assert.equal(tileURL('/v2/radar/abcd', {x:118,y:74}),
    'https://tilecache.rainviewer.com/v2/radar/abcd/512/7/118/74/2/0_0.png');
  assert.throws(() => tileURL('/v2/radar/../../secret', {x:118,y:74}), /Untrusted/);
  assert.throws(() => tileURL('/v2/radar/a', {x:-1,y:74}), /Invalid/);
});
test('names the host and the network cause behind "fetch failed"', () => {
  const dns = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo EAI_AGAIN api.rainviewer.com'), { code: 'EAI_AGAIN' }) });
  assert.equal(describeFetchError('https://api.rainviewer.com/public/weather-maps.json', dns),
    'api.rainviewer.com: fetch failed (EAI_AGAIN getaddrinfo EAI_AGAIN api.rainviewer.com)');
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal(describeFetchError('https://tilecache.rainviewer.com/v2/x.png', timeout), 'tilecache.rainviewer.com: no answer within 12 s');
  assert.equal(describeFetchError('not a url', new Error('boom')), 'RainViewer: boom');
});
