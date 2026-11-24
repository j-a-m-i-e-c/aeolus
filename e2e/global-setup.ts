// e2e/global-setup.ts — wait for a disposable stack, and refuse anything else.
//
// The suite is destructive: specs replace the whole dashboard layout, delete
// automations by name and create clients and keys. So before any spec runs it
// checks two things and stops the run if either fails:
//
//   1. The backend at E2E_API_URL reports `e2e: true` from /api/health. Only a
//      backend started with AEOLUS_E2E=true does that (src/config.ts); it cannot be
//      set through the API. The disposable stack (e2e/docker-compose.e2e.yml) sets it.
//   2. The SPA at E2E_BASE_URL calls that same backend. Otherwise a check against a
//      disposable API could still let the browser change an everyday installation.
//
// Container health can lag behind "up", so both are polled first.

import { chromium } from "@playwright/test";
import { API_URL, BASE_URL } from "./constants";

const MAX_WAIT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
const START_HINT = "Start the disposable stack with `make e2e-up`.";

async function waitFor(name: string, url: string): Promise<Response> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        process.stdout.write(`[e2e] ${name} ready (${url})\n`);
        return res;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `[e2e] ${name} not reachable at ${url} after ${MAX_WAIT_MS / 1000}s ` +
      `(last error: ${lastError}). ${START_HINT}`,
  );
}

/** Refuse a backend that does not identify itself as disposable. */
export function assertDisposableHealth(body: unknown, apiUrl: string): void {
  if (typeof body === "object" && body !== null && (body as { e2e?: unknown }).e2e === true) return;
  throw new Error(
    `[e2e] Refusing to run: the backend at ${apiUrl} is not marked as a disposable E2E installation. ` +
      "The suite replaces the dashboard layout and deletes test automations, so it only runs against a " +
      `backend started with AEOLUS_E2E=true. ${START_HINT} Never set AEOLUS_E2E on a real installation.`,
  );
}

/** Refuse an SPA whose API calls go somewhere other than the checked backend. */
async function assertFrontendUsesBackend(): Promise<void> {
  const expected = new URL(API_URL).origin;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const firstApiCall = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith("/api/"), { timeout: 30_000 });
    // Answer nothing: the check must not let the SPA reach any backend.
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(BASE_URL);
    const actual = new URL((await firstApiCall).url()).origin;
    if (actual !== expected) {
      throw new Error(
        `[e2e] Refusing to run: the SPA at ${BASE_URL} calls ${actual}, not the disposable backend ${expected}. ` +
          "Point E2E_BASE_URL at a frontend built or served for that backend.",
      );
    }
    process.stdout.write(`[e2e] frontend calls the disposable backend (${actual})\n`);
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const health = await waitFor("backend", `${API_URL}/api/health`);
  assertDisposableHealth(await health.json().catch(() => null), API_URL);
  await waitFor("frontend", BASE_URL);
  await assertFrontendUsesBackend();
}
