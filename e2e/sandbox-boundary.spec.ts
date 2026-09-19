import { test, expect } from "@playwright/test";

test("custom UI sandbox has an opaque origin and no direct network/storage escape", async ({ page }) => {
  await page.goto("/");
  const handle = await page.evaluateHandle(() => {
    const iframe = document.createElement("iframe");
    iframe.id = "boundary-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.src = "/sandbox.html";
    document.body.appendChild(iframe);
    return iframe;
  });
  await expect(page.locator("#boundary-frame")).toHaveAttribute("sandbox", "allow-scripts");
  const element = handle.asElement();
  expect(element).not.toBeNull();
  const frame = await element!.contentFrame();
  expect(frame).not.toBeNull();
  await frame!.waitForLoadState("domcontentloaded");
  expect(await frame!.evaluate(() => window.origin)).toBe("null");
  expect(await frame!.evaluate(() => {
    try { localStorage.setItem("escape", "1"); return "allowed"; }
    catch (error) { return error instanceof DOMException ? error.name : "blocked"; }
  })).toBe("SecurityError");
  expect(await frame!.evaluate(async () => {
    try { await fetch("/api/health"); return "allowed"; }
    catch { return "blocked"; }
  })).toBe("blocked");
});
