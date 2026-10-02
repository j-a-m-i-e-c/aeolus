// e2e/session-drafts.spec.ts — ADR-0025 verification in a real browser.
//
// ADR-0025 made three claims that jsdom cannot establish, and said the ADR must
// stay Proposed until they were validated in a browser:
//
//   1. crash recovery      — unsaved authoring survives losing the tab, and is
//                            offered back rather than silently applied;
//   2. concurrent editors  — a save is refused when the project moved on the
//                            server, and the local draft is kept;
//   3. offline reconnect   — a temporary outage neither ends the session nor
//                            discards the editor, and recovers on its own.
//
// Recovery snapshots live in IndexedDB, which jsdom does not implement. The unit
// tests cover the store (frontend/src/lib/automation-drafts.test.ts) and the hook
// against a mocked store; only a real browser can show that a draft written by
// one page load is offered to the next.
//
// Each test gets a fresh browser context, so IndexedDB starts empty. Reloads
// inside a test keep it — which is the point.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./constants";
import { adminAuth, ensureAdmin, layoutRevision, projectRevision, withIfMatch } from "./helpers";

const TAB_ID = "tab-e2e-drafts";
const TAB_NAME = "E2E Drafts";
const TAB_SLUG = TAB_NAME.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
const RULE_NAME = "E2E Draft Recovery";

const SERVER_MARKER = "server-version";
const LOCAL_MARKER = "local-unsaved-edit";
const OTHER_EDITOR_MARKER = "other-editor-version";

const INITIAL_PROJECT = {
  logicEntry: "logic/index.ts",
  uiEntry: null as string | null,
  files: [
    {
      path: "logic/index.ts",
      content: [
        `export default async function run(context: EventContext) {`,
        `  state.set("origin", "${SERVER_MARKER}");`,
        `}`,
      ].join("\n"),
    },
  ],
};

interface Seeded {
  ruleId: string;
  auth: { Authorization: string };
}

/** Reset the automation, tab and pane to a known baseline. */
async function seedBaseline(request: APIRequestContext): Promise<Seeded> {
  const auth = await adminAuth(request);

  const existing = await (await request.get(`${API_URL}/api/automations`, { headers: auth })).json() as
    Array<{ id: string; name: string }>;
  const found = existing.find((rule) => rule.name === RULE_NAME);

  let ruleId: string;
  if (found) {
    ruleId = found.id;
    const revision = await projectRevision(request, ruleId, auth);
    const reset = await request.put(`${API_URL}/api/automations/${ruleId}/project`, { headers: withIfMatch(auth, revision), data: INITIAL_PROJECT });
    expect(reset.ok(), `reset failed: ${reset.status()} ${await reset.text()}`).toBeTruthy();
  } else {
    const created = await request.post(`${API_URL}/api/automations`, {
      headers: auth,
      data: {
        name: RULE_NAME,
        ruleType: "script",
        triggerType: "mqtt",
        triggerTopic: "sensor/e2e/drafts",
        project: INITIAL_PROJECT,
      },
    });
    expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    ruleId = (await created.json()).id as string;
  }

  const now = new Date().toISOString();
  const currentLayoutRevision = await layoutRevision(request, auth);
  const layout = await request.put(`${API_URL}/api/layout`, {
    headers: withIfMatch(auth, currentLayoutRevision),
    data: {
      tabs: [{ id: TAB_ID, name: TAB_NAME, icon: "code", order: 0, pinned: false, createdAt: now }],
      panes: [{
        id: `${TAB_ID}-pane-0`, tabId: TAB_ID, x: 0, y: 0, w: 12, h: 24, createdAt: now,
        paneType: "automation", config: { ruleId, ruleName: RULE_NAME },
      }],
    },
  });
  expect(layout.ok(), `layout failed: ${layout.status()}`).toBeTruthy();
  return { ruleId, auth };
}

async function readProjectSource(request: APIRequestContext, seeded: Seeded): Promise<string> {
  const res = await request.get(`${API_URL}/api/automations/${seeded.ruleId}/project`, { headers: seeded.auth });
  expect(res.ok()).toBeTruthy();
  const project = await res.json() as { files: Array<{ path: string; content: string }> };
  return project.files.find((f) => f.path === "logic/index.ts")!.content;
}

/** Enter the pane's project editor. */
async function openEditor(page: Page): Promise<void> {
  await page.goto(`/tab/${TAB_SLUG}`);
  await expect(page.getByText(RULE_NAME).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Replace the active file's contents by typing over a full selection.
 *
 * The logic stays on one line deliberately. Inserting a newline straight after an
 * opening brace lets Monaco's auto-indent/auto-close contribute a closing brace of
 * its own, which leaves unbalanced source and turns every later assertion into a
 * confusing transpile failure rather than the thing under test.
 */
async function replaceActiveContent(page: Page, content: string): Promise<void> {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(content);
  await expect(page.locator(".monaco-editor").first()).toContainText(content.slice(0, 40));
}

function editedLogic(marker: string): string {
  return `export default async function run(context: EventContext) { state.set("origin", "${marker}"); }`;
}

/**
 * The draft keys actually present in the browser's IndexedDB.
 *
 * The UI is an indirect witness to the store: a banner can be absent because the
 * snapshot was removed, or because it has not been read yet. Reading the keys
 * makes "the draft is gone" and "the draft is there" directly assertable, and it
 * removes the race where a fire-and-forget delete has not yet committed when the
 * test reloads the page.
 */
async function draftKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("aeolus-automation-drafts", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("snapshots")) {
            db.close();
            resolve([]);
            return;
          }
          const keys = db.transaction("snapshots").objectStore("snapshots").getAllKeys();
          keys.onsuccess = () => {
            const result = keys.result.map(String);
            db.close();
            resolve(result);
          };
          keys.onerror = () => {
            db.close();
            reject(keys.error);
          };
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

const draftBanner = (page: Page) => page.getByText(/Unsaved local automation draft from/);
const draftSaved = (page: Page) => page.getByText(/Local recovery draft saved/);
const saveButton = (page: Page) => page.getByRole("button", { name: "Save Automation", exact: true });

test.describe("ADR-0025 — resilient sessions and local draft recovery", () => {
  test("offers unsaved authoring back after the tab is lost, without touching the server", async ({ page, request }) => {
    test.slow(); // Monaco, a debounce window and a full reload.

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);
    await openEditor(page);

    // ── Edit without saving, and wait for the snapshot to be written ──
    await replaceActiveContent(page, editedLogic(LOCAL_MARKER));
    await expect(draftSaved(page)).toBeVisible({ timeout: 15_000 });

    // The snapshot is local only: an unsaved draft must never reach the server.
    expect(await readProjectSource(request, seeded)).toContain(SERVER_MARKER);

    // ── Lose the tab. IndexedDB survives a reload; React state does not. ──
    await page.reload();
    await openEditor(page);

    // ── Offered, not applied: the editor still shows the server version ──
    await expect(draftBanner(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".monaco-editor").first()).toContainText(SERVER_MARKER);
    await expect(page.locator(".monaco-editor").first()).not.toContainText(LOCAL_MARKER);

    // ── Restore on request ──
    await page.getByRole("button", { name: "Restore local draft" }).click();
    await expect(page.locator(".monaco-editor").first()).toContainText(LOCAL_MARKER);
    await expect(draftBanner(page)).toBeHidden();

    // Still local until an explicit save.
    expect(await readProjectSource(request, seeded)).toContain(SERVER_MARKER);

    // ── Saving the recovered work persists it, and retires the snapshot ──
    await saveButton(page).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await readProjectSource(request, seeded)).toContain(LOCAL_MARKER);
    await expect.poll(() => draftKeys(page), { timeout: 15_000 }).toEqual([]);
  });

  test("discards a rejected draft and leaves the server version in place", async ({ page, request }) => {
    test.slow();

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);
    await openEditor(page);

    await replaceActiveContent(page, editedLogic(LOCAL_MARKER));
    await expect(draftSaved(page)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await openEditor(page);
    await expect(draftBanner(page)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Discard local draft" }).click();
    await expect(draftBanner(page)).toBeHidden();
    await expect(page.locator(".monaco-editor").first()).toContainText(SERVER_MARKER);

    // Wait for the removal to commit before reloading. The hook deletes without
    // awaiting, which is right for the product — nothing should block the author —
    // but it means the UI goes quiet a moment before the store does.
    await expect.poll(() => draftKeys(page), { timeout: 15_000 }).toEqual([]);

    // A discarded draft stays gone across another reload.
    await page.reload();
    await openEditor(page);
    await expect(draftBanner(page)).toBeHidden({ timeout: 15_000 });
    expect(await readProjectSource(request, seeded)).toContain(SERVER_MARKER);
  });

  test("refuses to overwrite a project another editor changed, keeping the local draft", async ({ page, request }) => {
    test.slow();

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);
    await openEditor(page);

    // ── This editor has unsaved work ──
    await replaceActiveContent(page, editedLogic(LOCAL_MARKER));
    await expect(draftSaved(page)).toBeVisible({ timeout: 15_000 });

    // ── Another editor saves the same automation while this one is open. An API
    //    PUT is exactly what the other editor's save performs. ──
    const theirRevision = await projectRevision(request, seeded.ruleId, seeded.auth);
    const theirSave = await request.put(`${API_URL}/api/automations/${seeded.ruleId}/project`, {
      headers: withIfMatch(seeded.auth, theirRevision),
      data: { ...INITIAL_PROJECT, files: [{ path: "logic/index.ts", content: editedLogic(OTHER_EDITOR_MARKER) }] },
    });
    expect(theirSave.ok(), `concurrent save failed: ${theirSave.status()}`).toBeTruthy();

    // ── The pre-save re-read must refuse this save ──
    await saveButton(page).click();
    await expect(page.getByText(/changed (?:in another browser|on the server)/i)).toBeVisible({ timeout: 20_000 });

    // The other editor's work is intact: no blind overwrite.
    expect(await readProjectSource(request, seeded)).toContain(OTHER_EDITOR_MARKER);

    // This editor stays open with its own work, and the draft is still recoverable.
    await expect(saveButton(page)).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toContainText(LOCAL_MARKER);
    await page.reload();
    await openEditor(page);
    await expect(draftBanner(page)).toBeVisible({ timeout: 15_000 });
  });

  test("keeps the session and the editor through an outage, then saves once it clears", async ({ page, request }) => {
    test.slow();

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);
    await openEditor(page);

    await replaceActiveContent(page, editedLogic(LOCAL_MARKER));
    await expect(draftSaved(page)).toBeVisible({ timeout: 15_000 });

    // ── The Pi becomes unreachable. Only the API is cut: the browser still has
    //    the app, which is what a reboot or a Wi-Fi drop looks like from here. ──
    await page.route("**/api/**", (route) => route.abort("connectionrefused"));

    await saveButton(page).click();

    // Not signed out, not navigated away, and the authored work is still here.
    await expect(page.locator(".monaco-editor").first()).toContainText(LOCAL_MARKER);
    await expect(saveButton(page)).toBeVisible();
    await expect(page.getByText("Sign in to your dashboard")).toBeHidden();
    // The offline save changed nothing on the server.
    await page.unroute("**/api/**");
    expect(await readProjectSource(request, seeded)).toContain(SERVER_MARKER);

    // ── Connectivity returns: the same editor can now save ──
    await saveButton(page).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await readProjectSource(request, seeded)).toContain(LOCAL_MARKER);
  });

  test("issues a refresh cookie scoped to the administrator's chosen session length", async ({ request, playwright }) => {
    // The policy is stored with the user and read when the refresh token is
    // minted, so the only end-to-end witness that an admin's choice took effect
    // is the lifetime of the cookie that user receives.
    const auth = await adminAuth(request);
    const username = `e2e-policy-${Date.now()}`;
    const password = "e2e-policy-pass-123";

    const created = await request.post(`${API_URL}/api/auth/users`, {
      headers: auth,
      data: { username, password, groupId: null, role: "user", sessionDays: 1, inactivityMinutes: 30 },
    });
    expect(created.ok(), `create user failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    const body = await created.json() as { id: string; sessionDays: number; inactivityMinutes: number };
    expect(body.sessionDays).toBe(1);
    expect(body.inactivityMinutes).toBe(30);

    // An isolated cookie jar: signing in here must not replace the admin's
    // refresh cookie in the shared context the rest of the suite relies on.
    const isolated = await playwright.request.newContext();
    try {
      const signIn = await isolated.post(`${API_URL}/api/auth/login`, { data: { username, password } });
      expect(signIn.ok(), `login failed: ${signIn.status()}`).toBeTruthy();

      const setCookie = signIn.headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value)
        .find((v) => v.startsWith("refreshToken="));
      expect(setCookie, "no refreshToken cookie was set").toBeTruthy();

      // One day, not the seven-day default.
      expect(setCookie).toContain("Max-Age=86400");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie!.toLowerCase()).toContain("samesite=strict");
    } finally {
      await isolated.dispose();
      await request.delete(`${API_URL}/api/auth/users/${body.id}`, { headers: auth });
    }
  });

  test("shows a reconnecting screen on load when the server is unreachable, not a login or setup screen", async ({ page, request }) => {
    await ensureAdmin(page);
    await seedBaseline(request);

    // A reachable app with an unreachable backend: the exact state a laptop is in
    // while the Pi reboots. Claiming "not configured" or "signed out" here would
    // be a guess, and signing the operator out would discard their editor.
    await page.route("**/api/**", (route) => route.abort("connectionrefused"));
    await page.reload();

    await expect(page.getByText(/Aeolus is unreachable\. Reconnecting/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Create Admin Account" })).toBeHidden();
    await expect(page.getByText("Sign in to your dashboard")).toBeHidden();

    // ── Recovers without a manual reload once the backend answers again ──
    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/Aeolus is unreachable/)).toBeHidden({ timeout: 20_000 });
  });
});
