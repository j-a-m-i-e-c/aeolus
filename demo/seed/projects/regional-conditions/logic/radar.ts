// Optional RainViewer radar ingestion via an external collector and local MQTT.
// This automation stores bounded colour data, never images, map tiles or URLs.
const MAX_FRAMES = 4;
const GRID_BYTES = 80 * 80;
const MAX_AGE = 2 * 3600 * 1000;
const REGION = [152, -30.2, 154.2, -27.7];

type RadarFrame = { capturedAt: number; size: number; palette: string[]; grid: string; bounds: number[] };

function validFrame(value: any, now: number): value is RadarFrame {
  if (!value || value.size !== 80 || !Number.isInteger(value.capturedAt) ||
      value.capturedAt <= 0 || value.capturedAt > now + 5 * 60000 || now - value.capturedAt > MAX_AGE) return false;
  if (!Array.isArray(value.palette) || value.palette.length > 30 ||
    !value.palette.every((c: unknown) => typeof c === 'string' && /^[0-9a-fA-F]{6}$/.test(c))) return false;
  if (typeof value.grid !== 'string' || value.grid.length !== Math.ceil(GRID_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.grid)) return false;
  return Array.isArray(value.bounds) && value.bounds.length === 4 &&
    value.bounds.every((c: unknown, i: number) => typeof c === 'number' && Math.abs(c - REGION[i]) < 0.001);
}

export function ingestRadar(input: Record<string, unknown> | null | undefined, now: number) {
  if (!input || input.product !== 'RAINVIEWER' || !Array.isArray(input.frames) || input.frames.length > MAX_FRAMES) return;
  // Reject the entire bundle if even one frame is bad: do not quietly publish a
  // seemingly coherent but partly untrusted animation.
  if (!input.frames.length || !input.frames.every((f) => validFrame(f, now))) return;
  const frames = input.frames as RadarFrame[];
  if (new Set(frames.map((f) => f.capturedAt)).size !== frames.length) return;
  const next = [...frames].sort((a, b) => a.capturedAt - b.capturedAt);
  if (JSON.stringify(state.get('radarFrames') || []) === JSON.stringify(next)) return;
  // Four 80x80 frames remain within the Automation State value limit.
  if (JSON.stringify(next).length > 55_000) return;
  state.set('radarFrames', next);
  state.set('radarReceivedAt', now);
}
