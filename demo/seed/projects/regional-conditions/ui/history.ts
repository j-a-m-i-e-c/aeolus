// Read the bounded history shards written by the Regional Conditions Logic.
// The old unsharded key is still readable during a rolling showcase upgrade.
const PARTS = 8;
export function readHistory(read: (key: string) => unknown, key: string) {
  const legacy = read(key);
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) return legacy;
  const result: Record<string, unknown> = {};
  for (let i = 0; i < PARTS; i++) {
    const part = read(`${key}:${i}`);
    if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(result, part);
  }
  return result;
}
