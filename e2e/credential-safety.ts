// e2e/credential-safety.ts — keep Project API keys out of E2E artifacts.
//
// The Project API spec issues a real key, reads it from the one-time reveal dialog
// and types it into the test-request form. Anything Playwright records can then
// carry it: screenshots, videos, traces, step titles (`fill` puts its value in the
// title) and the failure page snapshot in error-context.md. So:
//
// - `maskedScreenshot` is the only screenshot call in e2e/. It masks every key
//   field and refuses to capture when a key is visible anywhere else on the page.
// - `enterSecret` sets an input without `fill`, so the value is not in a step title.
// - `scrubCredentials` replaces any key in the DOM before Playwright takes its
//   failure snapshot (the page fixture closes after afterEach hooks).
// - global-teardown.ts scans test-results/ for the key format and fails the run.
//
// The spec using these also turns trace, video and automatic screenshots off.

import type { Locator, Page, TestInfo } from "@playwright/test";
import { API_KEY_PATTERN } from "../scripts/e2e/credential-scan.mjs";

const MASKED = "data-e2e-credential-mask";

/** Every field that can hold a full key: the reveal dialog and the test-request input. */
export function credentialMasks(page: Page): Locator[] {
  return [page.getByLabel("API key", { exact: true }), page.locator('input[type="password"]')];
}

/** Elements showing a key (input value or text) that are not inside a masked field. */
async function unmaskedKeyCount(page: Page): Promise<number> {
  return page.evaluate(({ source, attribute }) => {
    const pattern = new RegExp(source);
    let count = 0;
    for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) {
      if (pattern.test(field.value) && !field.closest(`[${attribute}]`)) count += 1;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (pattern.test(node.textContent ?? "") && !node.parentElement?.closest(`[${attribute}]`)) count += 1;
    }
    return count;
  }, { source: API_KEY_PATTERN.source, attribute: MASKED });
}

/**
 * Screenshot with every key field masked, attached to the test. Throws, without
 * capturing, if a key is visible outside those fields. Returns how many elements
 * were masked, so a caller can assert the mask covered the field it expects.
 */
export async function maskedScreenshot(page: Page, testInfo: TestInfo, file: string, name: string): Promise<number> {
  const masks = credentialMasks(page);
  let masked = 0;
  for (const mask of masks) {
    masked += await mask.evaluateAll((elements, attribute) => {
      for (const element of elements) element.setAttribute(attribute, "");
      return elements.length;
    }, MASKED);
  }
  const exposed = await unmaskedKeyCount(page);
  if (exposed > 0) throw new Error(`Refusing to capture "${name}": an API key is visible outside the masked fields (${exposed} element(s)).`);
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: false, mask: masks });
  await testInfo.attach(name, { path: testInfo.outputPath(file), contentType: "image/png" });
  return masked;
}

/** Set a React-controlled input without `fill`, whose step title would contain the value. */
export async function enterSecret(field: Locator, secret: string): Promise<void> {
  await field.evaluate((element, value) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, secret);
}

/** Replace every key in the DOM, so a failure page snapshot cannot record one. */
export async function scrubCredentials(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate((source) => {
    const pattern = new RegExp(source, "g");
    for (const field of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) {
      field.value = field.value.replace(pattern, "[redacted]");
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent) node.textContent = node.textContent.replace(pattern, "[redacted]");
    }
  }, API_KEY_PATTERN.source);
}
