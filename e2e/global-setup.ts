// e2e/global-setup.ts — Wait for the compose stack to be reachable before specs.
//
// Option A means the frontend + backend + broker are already running (via
// `docker compose up`). Container health can lag a few seconds behind "up", so
// we poll both the SPA and the backend health endpoint until they respond,
// failing fast with a clear message if the stack was never started.

import { API_URL, BASE_URL } from "./constants";

const MAX_WAIT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

async function waitFor(name: string, url: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        process.stdout.write(`[e2e] ${name} ready (${url})\n`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `[e2e] ${name} not reachable at ${url} after ${MAX_WAIT_MS / 1000}s ` +
      `(last error: ${lastError}). Is the stack up? Try: docker compose up -d`,
  );
}

export default async function globalSetup(): Promise<void> {
  await waitFor("backend", `${API_URL}/api/health`);
  await waitFor("frontend", BASE_URL);
}
