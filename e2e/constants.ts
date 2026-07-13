// e2e/constants.ts — Shared endpoints and fixed credentials for the e2e suite.
//
// The suite assumes a FRESH backend (empty DB) so the first-run setup journey
// can create the admin. In CI this is guaranteed by starting the stack with
// clean volumes (`docker compose down -v && docker compose up`).

export const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

/** Backend origin — the browser calls this directly (see frontend/src/lib/env.ts). */
export const API_URL = process.env.E2E_API_URL || "http://localhost:3001";

/** Admin account created by the first-run setup journey and reused thereafter. */
export const ADMIN = {
  username: "e2e-admin",
  // Must be >= 8 chars to satisfy SetupPage validation.
  password: "e2e-password-123",
};
