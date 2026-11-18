// Optional companion for local showcase OR a permitted small-community deployment.
// Fetch RainViewer tile PNGs outside the Aeolus iframe, render them to a bounded
// geographic colour grid, publish one retained MQTT message containing four frames.
// The custom UI draws its own SVG. Never put radar URLs or images in the UI.
import { regionalRadarGrid } from './rainviewer-grid.mjs';
import { INDEX_URL, selectFrames, tileCoordinates, tileURL } from './rainviewer-api.mjs';

const TOPIC = 'aeolus/local/radar/northern-rivers';
const INTERVAL_MS = 10 * 60_000;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_MESSAGE_BYTES = 57_000;
const cached = new Map();
let lastPublished = '';
let running = false;

async function getBytes(url, maxBytes = MAX_IMAGE_BYTES) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: 'error',
    headers: { 'User-Agent': 'Aeolus-RegionalConditions/0.1 (+https://aeolus.com.au)' } });
  if (!response.ok) throw new Error(`RainViewer request returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Oversized radar response');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw new Error('Oversized radar response');
  return data;
}

async function loadFrame(frame) {
  const tiles = tileCoordinates();
  const entries = await Promise.all(tiles.map(async (tile) =>
    [`${tile.x},${tile.y}`, await getBytes(tileURL(frame.path, tile))]));
  const values = regionalRadarGrid(new Map(entries));
  return { capturedAt: frame.capturedAt, ...values };
}

async function publish(payload) {
  const { default: mqtt } = await import('mqtt');
  const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883', {
    username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 0, connectTimeout: 5000, protocolVersion: 5,
  });
  try {
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
    await new Promise((resolve, reject) => client.publish(TOPIC, payload, { qos: 1, retain: true },
      (error) => error ? reject(error) : resolve()));
  } finally { client.end(true); }
}

async function run() {
  if (running) return;
  running = true;
  try {
    const index = JSON.parse((await getBytes(INDEX_URL, 100_000)).toString('utf8'));
    const available = selectFrames(index);
    if (!available.length) throw new Error('No recent radar frames in RainViewer index');
    const keys = new Set(available.map((f) => f.capturedAt));
    for (const key of cached.keys()) if (!keys.has(key)) cached.delete(key);
    // One frame at a time to avoid unnecessary requests and keep third-party load low.
    // On first run backfill four frames, so the map animates immediately.
    for (const frame of available) {
      if (!cached.has(frame.capturedAt)) cached.set(frame.capturedAt, await loadFrame(frame));
    }
    const frames = available.map((f) => cached.get(f.capturedAt));
    const payload = JSON.stringify({ product: 'RAINVIEWER', frames });
    if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) throw new Error('Radar MQTT message exceeds safety cap');
    if (payload === lastPublished) return;
    if (process.env.RAINVIEWER_DRY_RUN === '1') {
      console.log(`RainViewer: ${frames.length} frames, ${frames.at(-1).occupied} cells in latest, ${Buffer.byteLength(payload)} bytes; dry run`);
      lastPublished = payload;
      return;
    }
    await publish(payload);
    lastPublished = payload;
    console.log(`RainViewer: published ${frames.length} frames; latest ${new Date(frames.at(-1).capturedAt).toISOString()}`);
  } catch (error) {
    console.error('RainViewer radar: ' + (error instanceof Error ? error.message : String(error)));
    if (process.argv.includes('--once')) process.exitCode = 1;
  } finally { running = false; }
}

if (process.argv.includes('--once')) await run();
else {
  await run();
  setInterval(run, INTERVAL_MS);
}
