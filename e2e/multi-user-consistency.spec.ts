// e2e/multi-user-consistency.spec.ts — ADR-0026 simultaneous-client verification.
//
// These tests deliberately start two independent Chromium contexts against the
// same site. Both clients read the same server revision before either writes.
// Exactly one stale write may commit; the other must fail rather than silently
// replacing the first client's work.

import { test, expect, type BrowserContext, type Page, type APIRequestContext } from "@playwright/test";
import { API_URL, STORAGE_STATE } from "./constants";
import { adminAuth, ensureAdmin, layoutRevision, projectRevision, withIfMatch } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const TAB_ID = "tab-e2e-concurrency";
const TAB_NAME = "E2E Concurrency";
const TAB_SLUG = "e2e-concurrency";
const RULE_NAME = "E2E Concurrent Save";

function project(marker: string) {
  return {
    logicEntry: "logic/index.ts",
    uiEntry: null as string | null,
    files: [{ path: "logic/index.ts", content: `export default async function run() { state.set("winner", "${marker}"); }` }],
  };
}

async function seed(request: APIRequestContext) {
  const auth = await adminAuth(request);
  const rules = await (await request.get(`${API_URL}/api/automations`, { headers: auth })).json() as Array<{ id: string; name: string }>;
  let ruleId = rules.find((rule) => rule.name === RULE_NAME)?.id;
  if (ruleId) {
    const revision = await projectRevision(request, ruleId, auth);
    const reset = await request.put(`${API_URL}/api/automations/${ruleId}/project`, {
      headers: withIfMatch(auth, revision), data: project("baseline"),
    });
    expect(reset.ok()).toBeTruthy();
  } else {
    const created = await request.post(`${API_URL}/api/automations`, {
      headers: auth,
      data: { name: RULE_NAME, ruleType: "script", triggerType: "mqtt", triggerTopic: "sensor/e2e/concurrency", project: project("baseline") },
    });
    expect(created.ok()).toBeTruthy();
    ruleId = (await created.json()).id as string;
  }

  const revision = await layoutRevision(request, auth);
  const now = Date.now();
  const layout = await request.put(`${API_URL}/api/layout`, {
    headers: withIfMatch(auth, revision),
    data: {
      tabs: [{ id: TAB_ID, name: TAB_NAME, icon: "code", order: 0, pinned: false, createdAt: now }],
      panes: [{ id: `${TAB_ID}-pane`, tabId: TAB_ID, paneType: "automation", config: { ruleId, ruleName: RULE_NAME }, x: 0, y: 0, w: 12, h: 20, createdAt: now }],
    },
  });
  expect(layout.ok()).toBeTruthy();
  return { auth, ruleId };
}

async function openSecondContext(browser: import("@playwright/test").Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: STORAGE_STATE, baseURL: BASE_URL });
  return { context, page: await context.newPage() };
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`/tab/${TAB_SLUG}`);
  await expect(page.getByText(RULE_NAME).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}

async function replaceLogic(page: Page, marker: string): Promise<void> {
  const source = project(marker).files[0].content;
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await expect(page.locator(".monaco-editor").first()).toContainText(marker);
}

async function apiToken(page: Page): Promise<string> {
  return page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/api/auth/refresh`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error(`refresh failed: ${response.status}`);
    const body = await response.json() as { accessToken: string };
    return body.accessToken;
  }, API_URL);
}

test.describe("ADR-0026 — simultaneous clients", () => {
  test("two real editors cannot silently overwrite the same Automation Project", async ({ page, browser, request }) => {
    test.slow();
    await ensureAdmin(page);
    const seeded = await seed(request);
    const other = await openSecondContext(browser);
    try {
      await Promise.all([openEditor(page), openEditor(other.page)]);
      await replaceLogic(page, "editor-a");
      await replaceLogic(other.page, "editor-b");

      const saveA = page.getByRole("button", { name: "Save Automation", exact: true });
      const saveB = other.page.getByRole("button", { name: "Save Automation", exact: true });
      await Promise.all([saveA.click(), saveB.click()]);

      // One editor returns to status; the stale one stays open with its draft.
      await expect.poll(async () => Number(await saveA.isVisible()) + Number(await saveB.isVisible()), { timeout: 20_000 }).toBe(1);
      const losingPage = await saveA.isVisible() ? page : other.page;
      await expect(losingPage.getByText(/changed (?:in another browser|on the server)/i)).toBeVisible({ timeout: 20_000 });

      const stored = await (await request.get(`${API_URL}/api/automations/${seeded.ruleId}/project`, { headers: seeded.auth })).json() as { files: Array<{ path: string; content: string }> };
      const source = stored.files.find((file) => file.path === "logic/index.ts")!.content;
      expect([source.includes("editor-a"), source.includes("editor-b")].filter(Boolean)).toHaveLength(1);
    } finally {
      await other.context.close();
    }
  });

  test("two browser layout writes from the same revision produce one commit and one conflict", async ({ page, browser, request }) => {
    await ensureAdmin(page);
    await seed(request);
    const other = await openSecondContext(browser);
    try {
      await Promise.all([page.goto(`/tab/${TAB_SLUG}`), other.page.goto(`/tab/${TAB_SLUG}`)]);
      const [tokenA, tokenB] = await Promise.all([apiToken(page), apiToken(other.page)]);
      const baseline = await (await request.get(`${API_URL}/api/layout`, { headers: await adminAuth(request) })).json() as { revision: number; tabs: any[]; panes: any[] };

      const write = (target: Page, token: string, suffix: string) => target.evaluate(async ({ apiUrl, token, baseline, suffix }) => {
        const tabs = baseline.tabs.map((tab: any) => tab.id === "tab-e2e-concurrency" ? { ...tab, name: `E2E Concurrency ${suffix}` } : tab);
        const response = await fetch(`${apiUrl}/api/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "If-Match": `"${baseline.revision}"` },
          body: JSON.stringify({ tabs, panes: baseline.panes }),
        });
        return response.status;
      }, { apiUrl: API_URL, token, baseline, suffix });

      const statuses = await Promise.all([write(page, tokenA, "A"), write(other.page, tokenB, "B")]);
      expect(statuses.sort((a, b) => a - b)).toEqual([200, 409]);
    } finally {
      await other.context.close();
    }
  });

  test("a stale browser cannot delete an automation after another browser advances its revision", async ({ page, browser, request }) => {
    await ensureAdmin(page);
    const seeded = await seed(request);
    const other = await openSecondContext(browser);
    try {
      await Promise.all([page.goto(`/tab/${TAB_SLUG}`), other.page.goto(`/tab/${TAB_SLUG}`)]);
      const auth = await adminAuth(request);
      const baselineRevision = await projectRevision(request, seeded.ruleId, auth);
      const advanced = await request.put(`${API_URL}/api/automations/${seeded.ruleId}/project`, {
        headers: withIfMatch(auth, baselineRevision),
        data: project("advanced-before-delete"),
      });
      expect(advanced.ok()).toBeTruthy();

      const staleDelete = await request.delete(`${API_URL}/api/automations/${seeded.ruleId}`, {
        headers: withIfMatch(auth, baselineRevision),
      });
      expect(staleDelete.status()).toBe(409);

      const stillThere = await request.get(`${API_URL}/api/automations/${seeded.ruleId}/project`, { headers: auth });
      expect(stillThere.ok()).toBeTruthy();
    } finally {
      await other.context.close();
    }
  });

});
