// e2e/automation-project.spec.ts — Multi-file Automation Project authoring in a real browser.
//
// The project editor wraps Monaco, so it is excluded from jsdom unit coverage
// (see frontend/vite.config.ts). This spec is where the multi-file workflow is
// actually verified: navigate the tree, edit a module, add a module, import it
// from the logic entry, save, reload and confirm the tree survived, then break
// the build and confirm the failure is reported, non-destructive, and
// recoverable.
//
// Setup uses the API to create the automation and its pane, mirroring exactly
// what demo/seed/lib.mjs does, so the browser drives production-shaped data
// rather than a bespoke fixture. Each test re-seeds a known baseline so they can
// run in any order and be re-run against a dirty database.

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { API_URL } from "./constants";
import { adminAuth, ensureAdmin } from "./helpers";

const TAB_ID = "tab-e2e-project";
const TAB_NAME = "E2E Project";
/** Custom tabs are routed by slugified name (see tabNameToSlug). */
const TAB_SLUG = TAB_NAME.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
const RULE_NAME = "E2E Project Automation";

/** The baseline project each test starts from. */
const INITIAL_PROJECT = {
  logicEntry: "logic/index.ts",
  uiEntry: "ui/index.tsx",
  files: [
    {
      path: "logic/index.ts",
      content: [
        `import { LABEL } from "./constants";`,
        `export default async function run(context: EventContext) {`,
        `  state.set("label", LABEL);`,
        `}`,
      ].join("\n"),
    },
    { path: "logic/constants.ts", content: `export const LABEL = "initial-label";` },
    { path: "ui/index.tsx", content: `export default function View() {\n  return <div>project ui</div>;\n}` },
  ],
};

interface Seeded {
  ruleId: string;
  auth: { Authorization: string };
}

/**
 * Ensure the project automation, tab and pane exist, and reset the project to
 * the baseline. Returns the rule id and an auth header for assertions.
 */
async function seedBaseline(request: APIRequestContext): Promise<Seeded> {
  const auth = await adminAuth(request);

  const existing = await (await request.get(`${API_URL}/api/automations`, { headers: auth })).json() as
    Array<{ id: string; name: string }>;
  const found = existing.find((rule) => rule.name === RULE_NAME);

  let ruleId: string;
  if (found) {
    ruleId = found.id;
    const reset = await request.put(`${API_URL}/api/automations/${ruleId}/project`, { headers: auth, data: INITIAL_PROJECT });
    expect(reset.ok(), `reset failed: ${reset.status()} ${await reset.text()}`).toBeTruthy();
  } else {
    const created = await request.post(`${API_URL}/api/automations`, {
      headers: auth,
      data: {
        name: RULE_NAME,
        ruleType: "script",
        triggerType: "mqtt",
        triggerTopic: "sensor/e2e/project",
        project: INITIAL_PROJECT,
      },
    });
    expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    ruleId = (await created.json()).id as string;
  }

  const now = new Date().toISOString();
  const layout = await request.put(`${API_URL}/api/layout`, {
    headers: auth,
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

async function readProject(request: APIRequestContext, seeded: Seeded) {
  const res = await request.get(`${API_URL}/api/automations/${seeded.ruleId}/project`, { headers: seeded.auth });
  expect(res.ok()).toBeTruthy();
  return await res.json() as { files: Array<{ path: string; content: string }>; logicEntry: string; uiEntry: string | null };
}

/** Open the tab and enter the project editor. */
async function openProjectEditor(page: Page): Promise<void> {
  await page.goto(`/tab/${TAB_SLUG}`);
  await expect(page.getByText(RULE_NAME).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Logic", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "UI", exact: true })).toBeVisible();
  // Monaco is lazy-loaded behind Suspense.
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  // Multi-file structure is progressive disclosure rather than the default surface.
  // The toggle is labelled "Files"; "Project files" is the heading inside the panel
  // it opens (3ca7ad8 reworked this toolbar), so matching the old name silently
  // matched nothing and left the tree closed for every assertion below.
  const projectFiles = page.getByRole("button", { name: "Files", exact: true });
  if (await projectFiles.isVisible()) await projectFiles.click();
  await expect(page.getByText("Project files", { exact: true })).toBeVisible();
}

const tree = (page: Page) => page.locator("aside");

/** Select a file in the project tree. */
async function selectFile(page: Page, filePath: string): Promise<void> {
  await tree(page).getByTitle(filePath, { exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

/** Replace the active file's contents. insertText avoids Monaco auto-closing. */
async function replaceActiveContent(page: Page, content: string): Promise<void> {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(content);
}

/**
 * The primary save action. `exact` matters: the editor toolbar also carries an
 * icon button titled "Save project", which a case-insensitive name match would
 * pick up as well.
 */
const saveButton = (page: Page) => page.getByRole("button", { name: "Save Automation", exact: true });

async function saveProject(page: Page): Promise<void> {
  await saveButton(page).click();
}

test.describe("Automation Project editor", () => {
  test("authors a multi-file project through the browser and persists it", async ({ page, request }) => {
    test.slow(); // Monaco plus several round trips.

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);

    // ── Open, and confirm the whole authored tree is browsable ──
    await openProjectEditor(page);
    for (const path of ["logic/index.ts", "logic/constants.ts", "ui/index.tsx"]) {
      await expect(tree(page).getByTitle(path, { exact: true })).toBeVisible();
    }
    // The Logic and UI entry points are the toolbar's primary surface. They used to
    // also carry an "Entry" text badge in the tree; that is now conveyed by icon
    // colour alone, so assert the entry buttons rather than a label that no longer
    // exists.
    await expect(page.getByRole("button", { name: "Logic", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "UI", exact: true })).toBeVisible();

    // ── Navigate between files ──
    await selectFile(page, "logic/constants.ts");
    await expect(page.locator(".monaco-editor").first()).toContainText("initial-label");
    await selectFile(page, "ui/index.tsx");
    await expect(page.locator(".monaco-editor").first()).toContainText("project ui");

    // ── Edit an existing module ──
    await selectFile(page, "logic/constants.ts");
    await replaceActiveContent(page, `export const LABEL = "edited-label";`);
    await expect(page.locator(".monaco-editor").first()).toContainText("edited-label");

    // ── Create a new module, then import it from the logic entry ──
    page.once("dialog", (dialog) => dialog.accept("logic/extra.ts"));
    await page.getByTitle("Add project file").click();
    await expect(tree(page).getByTitle("logic/extra.ts", { exact: true })).toBeVisible();
    await replaceActiveContent(page, `export const EXTRA = "extra-value";`);

    await selectFile(page, "logic/index.ts");
    await replaceActiveContent(page, [
      `import { LABEL } from "./constants";`,
      `import { EXTRA } from "./extra";`,
      `export default async function run(context: EventContext) {`,
      `  state.set("label", LABEL + "/" + EXTRA);`,
      `}`,
    ].join("\n"));

    // ── Save: the bundle must build with the new cross-module import ──
    await saveProject(page);
    // Returning to status mode is the pane's success signal.
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 20_000 });

    // ── Server-side truth: the authored tree moved ──
    const stored = await readProject(request, seeded);
    expect(stored.files.map((f) => f.path).sort()).toEqual([
      "logic/constants.ts", "logic/extra.ts", "logic/index.ts", "ui/index.tsx",
    ]);
    expect(stored.files.find((f) => f.path === "logic/extra.ts")!.content).toContain("extra-value");
    expect(stored.files.find((f) => f.path === "logic/constants.ts")!.content).toContain("edited-label");

    // ── Reload: the authored tree survives a fresh page load ──
    await openProjectEditor(page);
    await expect(tree(page).getByTitle("logic/extra.ts", { exact: true })).toBeVisible();
    await selectFile(page, "logic/extra.ts");
    await expect(page.locator(".monaco-editor").first()).toContainText("extra-value");
    await selectFile(page, "logic/constants.ts");
    await expect(page.locator(".monaco-editor").first()).toContainText("edited-label");
  });

  test("surfaces a compile failure, keeps the working project, and recovers", async ({ page, request }) => {
    test.slow();

    await ensureAdmin(page);
    const seeded = await seedBaseline(request);
    const before = await readProject(request, seeded);

    await openProjectEditor(page);

    // ── Break the build: import a module that does not exist ──
    await selectFile(page, "logic/index.ts");
    await replaceActiveContent(page, [
      `import { MISSING } from "./definitely-not-here";`,
      `export default async function run(context: EventContext) {`,
      `  state.set("label", MISSING);`,
      `}`,
    ].join("\n"));
    await saveProject(page);

    // A useful message that names the problem, shown in the editor.
    await expect(page.getByText(/definitely-not-here/i).first()).toBeVisible({ timeout: 20_000 });
    // Still in the editor — a failed save must not look like success.
    await expect(saveButton(page)).toBeVisible();

    // ── The previously working project is untouched on the server ──
    const during = await readProject(request, seeded);
    expect(during.files).toEqual(before.files);
    expect(during.logicEntry).toBe(before.logicEntry);
    expect(during.uiEntry).toBe(before.uiEntry);

    // ── Repair and save again ──
    await replaceActiveContent(page, [
      `import { LABEL } from "./constants";`,
      `export default async function run(context: EventContext) {`,
      `  state.set("label", LABEL + "|repaired");`,
      `}`,
    ].join("\n"));
    await saveProject(page);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 20_000 });

    const after = await readProject(request, seeded);
    expect(after.files.find((f) => f.path === "logic/index.ts")!.content).toContain(`LABEL + "|repaired"`);
  });
});
