// playwright.config.ts — End-to-end tests against the real Docker Compose stack.
//
// These tests drive the actual wiring (auth, cookies, WebSocket, the seed) by
// hitting the running frontend at http://localhost:3000, which in turn talks to
// the backend at http://localhost:3001. The stack is expected to already be up
// (via `docker compose up`); global-setup.ts waits for both to be reachable
// before any spec runs. Run locally with `make e2e` (stack up) or `make
// e2e-fresh` (clean first-run state); CI runs it in the `e2e` job.
//
// Deliberately NOT part of the vitest coverage run — vitest's root is `src/`,
// so nothing here is collected as a unit test or counted toward coverage.

import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/constants";

/** Where the SPA is served. Override with E2E_BASE_URL in CI if the port moves. */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // First-run setup is inherently order-dependent (create admin → log out → log
  // in), so specs run serially against the single shared backend rather than in
  // parallel. Fidelity over speed — that's the point of e2e here.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Signs in once and saves the state the specs reuse, so the suite does not
    // spend the login rate-limit budget re-authenticating per test. It also owns
    // the first-run setup journey, which must reach a pristine DB before anything
    // else creates the admin — a dependency, rather than alphabetical luck.
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
});
