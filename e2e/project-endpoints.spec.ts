// e2e/project-endpoints.spec.ts — the whole Project API workflow through the Aeolus UI
// (ADR-0027, Phase 4): open an Automation Project, inspect its endpoints, create the
// API, publish it, create a machine client, issue a key, grant a route, test the
// endpoint, call it as a client would, and unpublish.
//
// Each run seeds a fresh automation with a unique slug, because slugs are permanent
// and a deleted API's slug is retired. Screenshots of each step are attached to the
// test and written to its output directory (test-results/).
//
// The run handles a real API key, so it records nothing that could carry one
// unmasked: trace, video and automatic screenshots are off, every screenshot masks
// the key fields, the key is entered without `fill`, assertions never print it, and
// global-teardown.ts scans test-results/ for the key format (e2e/credential-safety.ts).

import { test, expect, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";
import { API_URL } from "./constants";
import { adminAuth, layoutRevision } from "./helpers";
import { enterSecret, maskedScreenshot, scrubCredentials } from "./credential-safety";
import { API_KEY_PATTERN } from "../scripts/e2e/credential-scan.mjs";

const TAB_ID = "tab-e2e-endpoints";
const TAB_NAME = "E2E Endpoints";
const TAB_SLUG = "e2e-endpoints";
const RULE_NAME = "E2E Tank Endpoints";

const ROUTES = {
  version: 1,
  routes: [
    {
      id: "tank-status",
      method: "GET",
      path: "/tanks/:id",
      handler: "getTank",
      description: "Level of one tank",
      response: {
        type: "object",
        properties: { id: { type: "string" }, levelPercent: { type: "number", minimum: 0, maximum: 100 } },
        required: ["id", "levelPercent"],
        additionalProperties: false,
      },
    },
    {
      id: "site-summary",
      method: "GET",
      path: "/summary",
      handler: "getSummary",
      response: { type: "object", properties: { tanks: { type: "integer" } }, required: ["tanks"] },
    },
  ],
};

const PROJECT = {
  logicEntry: "logic/index.ts",
  uiEntry: null,
  files: [
    { path: "logic/index.ts", content: `export default async function run() {\n  state.set("level", 61.5);\n}` },
    { path: "api/routes.json", content: JSON.stringify(ROUTES, null, 2) },
    {
      path: "api/handlers.ts",
      content: [
        `import { clamp } from "../lib/units";`,
        `export function getTank(req: { params: { id: string } }) {`,
        `  if (req.params.id !== "main") return api.response(404, { error: "Tank not found" });`,
        `  return { id: req.params.id, levelPercent: clamp(Number(state.get("level") ?? 42)) };`,
        `}`,
        `export function getSummary() { return { tanks: 1 }; }`,
      ].join("\n"),
    },
    { path: "lib/units.ts", content: `export const clamp = (n: number) => Math.max(0, Math.min(100, n));` },
  ],
};

async function seed(request: APIRequestContext): Promise<{ ruleId: string; auth: { Authorization: string } }> {
  const auth = await adminAuth(request);
  // A previous run's automation is deleted, which deletes its API and retires its slug.
  const existing = await (await request.get(`${API_URL}/api/automations`, { headers: auth })).json() as Array<{ id: string; name: string; revision?: number }>;
  for (const rule of existing.filter((candidate) => candidate.name === RULE_NAME)) {
    const project = await (await request.get(`${API_URL}/api/automations/${rule.id}/project`, { headers: auth })).json() as { revision: number };
    await request.delete(`${API_URL}/api/automations/${rule.id}`, { headers: { ...auth, "If-Match": `"${project.revision}"` } });
  }
  const created = await request.post(`${API_URL}/api/automations`, {
    headers: auth,
    data: { name: RULE_NAME, ruleType: "script", triggerType: "mqtt", triggerTopic: "sensor/e2e/endpoints", project: PROJECT },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const ruleId = (await created.json()).id as string;

  const now = new Date().toISOString();
  const layout = await request.put(`${API_URL}/api/layout`, {
    headers: { ...auth, "If-Match": `"${await layoutRevision(request, auth)}"` },
    data: {
      tabs: [{ id: TAB_ID, name: TAB_NAME, icon: "code", order: 0, pinned: false, createdAt: now }],
      panes: [{ id: `${TAB_ID}-pane-0`, tabId: TAB_ID, x: 0, y: 0, w: 12, h: 30, createdAt: now, paneType: "automation", config: { ruleId, ruleName: RULE_NAME } }],
    },
  });
  expect(layout.ok(), `layout failed: ${layout.status()}`).toBeTruthy();
  return { ruleId, auth };
}

// Traces record DOM snapshots and request headers, videos record the reveal dialog,
// and the automatic failure screenshot is unmasked: none are safe in this file.
// Playwright only accepts these at the top level, because they fix the worker.
test.use({ trace: "off", video: "off", screenshot: "off" });

let step = 0;
/** A masked step screenshot; returns how many key fields were masked. */
async function snap(page: Page, testInfo: TestInfo, name: string): Promise<number> {
  step += 1;
  return maskedScreenshot(page, testInfo, `${String(step).padStart(2, "0")}-${name}.png`, name);
}

test.describe("Project API endpoints through the UI", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  // Runs before the page closes, so Playwright's failure page snapshot
  // (error-context.md) sees no key. A masked screenshot replaces the automatic one.
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await scrubCredentials(page).catch(() => undefined);
    await maskedScreenshot(page, testInfo, "failure.png", "failure").catch(() => undefined);
  });

  test("publish, create a client, issue a key, grant a route and call it", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    step = 0;
    const { ruleId } = await seed(request);
    const slug = `e2e-tanks-${Date.now().toString(36)}`;
    const clientName = `E2E remote farm ${Date.now().toString(36)}`;

    // Open the Automation Project editor and its Endpoints view.
    await page.goto(`/tab/${TAB_SLUG}`);
    await expect(page.getByText(RULE_NAME).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
    // The existing API reference panel is still there.
    await page.getByRole("button", { name: "API", exact: true }).click();
    await expect(page.getByText("Logic API")).toBeVisible();
    await page.getByRole("button", { name: /Endpoints/ }).click();
    const publication = page.getByRole("region", { name: "Publication" });
    await expect(publication).toBeVisible({ timeout: 20_000 });
    const routes = page.getByRole("region", { name: "Declared routes" });
    await expect(routes.getByText("/tanks/{id}")).toBeVisible();
    await expect(routes.getByText("site-summary")).toBeVisible();
    await snap(page, testInfo, "declared-routes");

    // Create the API with its permanent slug.
    await publication.getByLabel("/api/exposed/v1/").fill(slug);
    await publication.getByRole("button", { name: "Create API" }).click();
    await expect(publication.getByText(`/api/exposed/v1/${slug}`)).toBeVisible();

    // Publish the reviewed content, after confirmation.
    await publication.getByRole("button", { name: "Publish", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByText(/You are approving revision/)).toBeVisible();
    await snap(page, testInfo, "publish-confirmation");
    await confirm.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(publication.getByText("Serving", { exact: true })).toBeVisible();
    await expect(publication.getByText("Matches saved source")).toBeVisible();
    await snap(page, testInfo, "published");

    // Create a machine client and issue it a key with an explicit expiry.
    const clients = page.getByRole("region", { name: "API clients" });
    await clients.scrollIntoViewIfNeeded();
    await clients.getByLabel("New client name").fill(clientName);
    await clients.getByRole("button", { name: /Create client/ }).click();
    await clients.getByRole("button", { name: new RegExp(clientName) }).click();
    await clients.getByLabel("New key expires").selectOption("30");
    await clients.getByRole("button", { name: "Issue key" }).click();
    const reveal = page.getByRole("dialog", { name: `New API key for ${clientName}` });
    await expect(reveal.getByText(/cannot be shown again/)).toBeVisible();
    const key = await reveal.getByRole("textbox", { name: "API key", exact: true }).inputValue();
    // Boolean checks, so a failure message cannot print the key.
    expect(API_KEY_PATTERN.test(key) && key.length === 64, "the revealed key has the documented format").toBe(true);
    expect(await snap(page, testInfo, "key-revealed-once"), "the revealed key field is masked").toBeGreaterThan(0);
    await reveal.getByRole("button", { name: "I have saved the key" }).click();
    await expect(reveal).toBeHidden();
    // Afterwards only the masked form is shown anywhere on the page.
    await expect(clients.getByText(new RegExp(`^aeo_${key.slice(4, 20)}_…`))).toBeVisible();
    expect((await page.content()).includes(key.slice(21)), "the secret part is gone from the page").toBe(false);

    // An ungranted key is refused with the uniform 404.
    const url = `${API_URL}/api/exposed/v1/${slug}/tanks/main`;
    expect((await request.get(url, { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(404);

    // Grant exactly one published route.
    const access = page.getByRole("region", { name: "Access" });
    await access.scrollIntoViewIfNeeded();
    await access.getByLabel("Client").selectOption({ label: clientName });
    await access.getByLabel("Published route").selectOption("tank-status");
    await access.getByRole("button", { name: "Grant access" }).click();
    await expect(access.getByRole("button", { name: `Revoke ${clientName}'s access to tank-status` })).toBeVisible();
    await snap(page, testInfo, "route-granted");

    // Test the endpoint from the UI, through the real pipeline.
    const calling = page.getByRole("region", { name: "Calling the API" });
    await calling.scrollIntoViewIfNeeded();
    await expect(calling.getByText(/\$AEOLUS_API_KEY/).first()).toBeVisible();
    await calling.getByRole("combobox").last().selectOption("tank-status");
    await calling.getByLabel("id", { exact: true }).fill("main");
    // A password input has no textbox role, so it is found by its label.
    await enterSecret(calling.getByLabel("API key", { exact: true }), key);
    await calling.getByRole("button", { name: /Send request/ }).click();
    await expect(calling.locator("span", { hasText: /^200$/ })).toBeVisible();
    await expect(calling.getByText(/"levelPercent"/)).toBeVisible();
    await snap(page, testInfo, "test-request");
    await calling.getByRole("button", { name: "Clear key" }).click();

    // The generated OpenAPI document of the snapshot.
    await calling.getByRole("button", { name: "Generate document" }).click();
    await expect(calling.getByRole("link", { name: new RegExp(`Download ${slug}.openapi.json`) })).toBeVisible();

    // Call it exactly as a client would.
    const served = await request.get(url, { headers: { Authorization: `Bearer ${key}` } });
    expect(served.status()).toBe(200);
    expect(await served.json()).toEqual({ id: "main", levelPercent: expect.any(Number) });
    expect(served.headers()["cache-control"]).toBe("no-store");
    // The other route was not granted.
    expect((await request.get(`${API_URL}/api/exposed/v1/${slug}/summary`, { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(404);

    // Activity shows what happened.
    const activity = page.getByRole("region", { name: "Activity" });
    await activity.scrollIntoViewIfNeeded();
    await expect(activity.getByText("Access granted")).toBeVisible();
    await expect(activity.getByText("Published", { exact: true })).toBeVisible();
    await snap(page, testInfo, "activity");

    // Unpublishing warns that every grant is revoked for good, then does it.
    await publication.scrollIntoViewIfNeeded();
    await publication.getByRole("button", { name: /Unpublish/ }).click();
    await expect(confirm.getByText(/every grant to this API is revoked permanently/)).toBeVisible();
    await snap(page, testInfo, "unpublish-warning");
    await confirm.getByRole("button", { name: "Unpublish and revoke 1 grant" }).click();
    await expect(page.getByText("Unpublished. 1 grant revoked.")).toBeVisible();
    expect((await request.get(url, { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(404);
    await snap(page, testInfo, "unpublished");

    // The client and its key survive an unpublish.
    const auth = await adminAuth(request);
    const listed = await (await request.get(`${API_URL}/api/project-apis/clients`, { headers: auth })).json() as { clients: Array<{ name: string; status: string; activeKeys: number; activeGrants: number }> };
    expect(listed.clients.find((candidate) => candidate.name === clientName)).toMatchObject({ status: "active", activeKeys: 1, activeGrants: 0 });
    expect(ruleId).toBeTruthy();
  });
});
