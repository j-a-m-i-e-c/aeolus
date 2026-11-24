// e2e/constants.ts — Shared endpoints and fixed credentials for the e2e suite.
//
// The suite runs only against a disposable stack (e2e/docker-compose.e2e.yml,
// `make e2e-up`), whose backend carries AEOLUS_E2E=true; global-setup.ts refuses
// anything else. A fresh volume lets auth.setup.ts walk the first-run journey.
// The defaults are that stack's ports, not the everyday stack's 3000/3001.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3100";

/** Backend origin — the browser calls this directly (see frontend/src/lib/env.ts). */
export const API_URL = process.env.E2E_API_URL || "http://localhost:3011";

/** Admin account created by the first-run setup journey and reused thereafter. */
export const ADMIN = {
  username: "e2e-admin",
  // Must be >= 8 chars to satisfy SetupPage validation.
  password: "e2e-password-123",
};

/**
 * Where the signed-in browser state is saved by auth.setup.ts.
 *
 * POST /api/auth/login is rate limited to 5 per minute per IP (auth.routes.ts) —
 * a deliberate control, and one a real client never approaches, because a browser
 * signs in once and then rides the httpOnly refresh cookie for a week. The suite
 * used to sign in again for every test, which on a fast machine tripped that cap
 * and reported the 429s as unrelated UI failures. Authenticating once and reusing
 * the state matches how a returning user actually arrives, and it keeps the
 * limiter itself in force and under test.
 *
 * Only the refresh cookie matters here: the access token lives in memory
 * (auth-store.ts holds it in Zustand with no persistence), and on load the app
 * calls POST /api/auth/refresh — which carries no rate limit — to mint a new one.
 */
export const STORAGE_STATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".auth",
  "admin.json",
);
