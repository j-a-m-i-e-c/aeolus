import { describe, expect, it } from 'vitest';
import { tabModules } from '../../scripts/seed/tabs/index.mjs';

describe('showcase custom UI typography', () => {
  it('keeps normal custom UI text readable', () => {
    for (const tab of tabModules) {
      for (const automation of tab.automations ?? []) {
        const ui = automation.uiSource;
        if (!ui) continue;

        const inlineSizes = [...ui.matchAll(/fontSize\s*:\s*(\d+(?:\.\d+)?)/g)]
          .map((match) => Number(match[1]));
        const svgSizes = [...ui.matchAll(/fontSize\s*=\s*(?:\{|["'])(\d+(?:\.\d+)?)/g)]
          .map((match) => Number(match[1]));

        for (const size of inlineSizes) {
          expect(size, `${tab.name}/${automation.key} inline font`).toBeGreaterThanOrEqual(11);
        }
        for (const size of svgSizes) {
          expect(size, `${tab.name}/${automation.key} SVG font`).toBeGreaterThanOrEqual(10);
        }
      }
    }
  });
});
