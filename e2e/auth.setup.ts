// e2e/auth.setup.ts — sign in once, and own the first-run journey while doing it.
//
// Runs as a Playwright `setup` project that every other project depends on, so it
// is guaranteed to execute first. Two jobs:
//
//   1. On a fresh backend, walk the real first-run setup journey — the public
//      /api/auth/status gate, the Create Admin form, landing on the dashboard.
//      This assertion used to live in auth.spec.ts and depended on Playwright's
//      alphabetical file ordering to reach a pristine DB before anything else
//      created the admin. Owning it here makes that ordering structural.
//   2. Save the signed-in browser state so the rest of the suite starts
//      authenticated instead of logging in again per test. See STORAGE_STATE in
//      constants.ts for why that matters.
//
// On an already-set-up backend it logs in instead, so the suite still runs against
// a stack someone has been using.

import { test as setup, expect } from "@playwright/test";
import { STORAGE_STATE } from "./constants";
import { createAdmin, isFreshBackend, login } from "./helpers";

setup("authenticates and saves the signed-in state", async ({ page }) => {
  const fresh = await isFreshBackend(page);

  if (fresh) {
    await createAdmin(page);
  } else {
    await login(page);
  }

  // /dashboard renders SystemPage unconditionally, even with no devices yet, and
  // the sidebar reflects the signed-in admin. Allow extra time when the backend
  // has just initialised and the frontend is hydrating cold.
  await expect(page.getByRole("heading", { name: "System" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("(admin)")).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
