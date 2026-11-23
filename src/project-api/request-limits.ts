// src/project-api/request-limits.ts — per-key and per-client admission for /api/exposed (ADR-0027).
//
// In memory, for the supported topology of one backend and one database. Limits reset
// when the backend restarts and are not shared between processes. Nothing here writes
// to disk, so heavy polling cannot wear a Pi's SD card.

export interface RequestLimits {
  /** Requests per key and per client in each fixed one-minute window. */
  perMinute: number;
  /** Requests one client may have running at once. */
  concurrentPerClient: number;
}

export type Admission =
  | { ok: true; release: () => void }
  | { ok: false; reason: "rate" | "concurrency"; retryAfterSeconds: number };

const WINDOW_MS = 60_000;
const MAX_TRACKED = 10_000;

export function createRequestLimiter(limits: RequestLimits, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  const active = new Map<string, number>();

  function count(key: string, at: number): { count: number; start: number } {
    let window = windows.get(key);
    if (!window || at - window.start >= WINDOW_MS) {
      if (windows.size >= MAX_TRACKED) {
        for (const [k, w] of windows) if (at - w.start >= WINDOW_MS) windows.delete(k);
      }
      window = { start: at, count: 0 };
      windows.set(key, window);
    }
    return window;
  }

  return {
    admit(clientId: string, credentialId: string): Admission {
      const at = now();
      const byKey = count(`key:${credentialId}`, at);
      const byClient = count(`client:${clientId}`, at);
      if (byKey.count >= limits.perMinute || byClient.count >= limits.perMinute) {
        const start = byKey.count >= limits.perMinute ? byKey.start : byClient.start;
        return { ok: false, reason: "rate", retryAfterSeconds: Math.max(1, Math.ceil((start + WINDOW_MS - at) / 1000)) };
      }
      const running = active.get(clientId) ?? 0;
      if (running >= limits.concurrentPerClient) return { ok: false, reason: "concurrency", retryAfterSeconds: 1 };
      byKey.count++;
      byClient.count++;
      active.set(clientId, running + 1);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          const left = (active.get(clientId) ?? 1) - 1;
          if (left <= 0) active.delete(clientId);
          else active.set(clientId, left);
        },
      };
    },
  };
}

export type RequestLimiter = ReturnType<typeof createRequestLimiter>;
