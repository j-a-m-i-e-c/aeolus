// Split each retained history across eight Automation State values, so no single value
// grows with the station count: 24 hours for every gauge in one value reached tens of
// kilobytes, and every write sends the whole value to the pane.
// History stays in Automation State because the showcase cannot assume the Data Store is
// enabled; a Data Store-backed history could replace this without changing the map.
const PARTS = 8;

type History = Record<string, unknown[]>;
function isHistory(value: unknown): value is History {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readHistory(key: string): History {
  // Read the pre-Build-69 value until it is safely migrated after the next fetch.
  const legacy = state.get(key);
  if (isHistory(legacy)) return legacy;
  const joined: History = {};
  for (let i = 0; i < PARTS; i++) {
    const part = state.get(`${key}:${i}`);
    if (isHistory(part)) Object.assign(joined, part);
  }
  return joined;
}

export function writeHistory(key: string, history: History): void {
  const parts: History[] = Array.from({ length: PARTS }, () => ({}));
  for (const [station, samples] of Object.entries(history)) {
    // Numeric WaterNSW station identifiers yield stable partitions.
    const shard = [...station].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 0) >>> 0;
    parts[shard % PARTS]![station] = samples;
  }
  // The old monolithic value is only discarded after every new shard is written.
  parts.forEach((part, i) => state.set(`${key}:${i}`, part));
  if (isHistory(state.get(key))) state.set(key, null);
}
