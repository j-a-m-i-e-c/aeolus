// frontend/src/lib/mutation-id.ts — identify this browser's configuration writes.
//
// Configuration invalidations are broadcast to every relevant WebSocket client,
// including the browser that originated the HTTP mutation. Remembering a short
// bounded set of mutation IDs lets the origin ignore its own echo while other
// tabs/devices (even for the same user) still receive the invalidation.

const recentLocalMutationIds: string[] = [];
const recentLocalMutationSet = new Set<string>();
const MAX_RECENT_MUTATIONS = 128;
let fallbackCounter = 0;

export function createMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `mutation-${Date.now()}-${fallbackCounter}`;
}

export function rememberLocalMutation(id: string): void {
  if (recentLocalMutationSet.has(id)) return;
  recentLocalMutationIds.push(id);
  recentLocalMutationSet.add(id);
  while (recentLocalMutationIds.length > MAX_RECENT_MUTATIONS) {
    const removed = recentLocalMutationIds.shift();
    if (removed) recentLocalMutationSet.delete(removed);
  }
}

export function consumeLocalMutation(id: unknown): boolean {
  if (typeof id !== "string" || !recentLocalMutationSet.has(id)) return false;
  recentLocalMutationSet.delete(id);
  const index = recentLocalMutationIds.indexOf(id);
  if (index >= 0) recentLocalMutationIds.splice(index, 1);
  return true;
}

/** Test-only reset; intentionally not used by production code. */
export function clearRememberedMutations(): void {
  recentLocalMutationIds.length = 0;
  recentLocalMutationSet.clear();
  fallbackCounter = 0;
}
