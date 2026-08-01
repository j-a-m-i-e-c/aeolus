// frontend/src/lib/pane-registry.test.ts — Unit tests for the pane registry lookup

import { describe, it, expect } from "vitest";
import { PANE_REGISTRY, getPaneEntry } from "./pane-registry";

const VALID_CATEGORIES = new Set(["controls", "automations", "monitoring", "system"]);

describe("getPaneEntry", () => {
  it("returns the entry for a known pane type", () => {
    const entry = getPaneEntry("hue-control");
    expect(entry).toBeDefined();
    expect(entry?.displayName).toBe("Hue Lights");
    expect(entry?.category).toBe("controls");
  });

  it("returns undefined for an unknown pane type", () => {
    expect(getPaneEntry("does-not-exist")).toBeUndefined();
  });
});

describe("PANE_REGISTRY entries", () => {
  it("every entry has a complete, well-formed shape", () => {
    for (const [type, entry] of Object.entries(PANE_REGISTRY)) {
      expect(entry.component, `${type}.component`).toBeTypeOf("function");
      expect(entry.displayName, `${type}.displayName`).toBeTruthy();
      expect(entry.defaultIcon, `${type}.defaultIcon`).toBeTruthy();
      expect(entry.defaultConfig, `${type}.defaultConfig`).toBeTypeOf("object");
      expect(entry.defaultSize.w, `${type}.defaultSize.w`).toBeGreaterThan(0);
      expect(entry.defaultSize.h, `${type}.defaultSize.h`).toBeGreaterThan(0);
      expect(VALID_CATEGORIES.has(entry.category), `${type}.category`).toBe(true);
    }
  });

  it("exposes at least one pane per category", () => {
    const categories = new Set(Object.values(PANE_REGISTRY).map((e) => e.category));
    expect(categories).toEqual(VALID_CATEGORIES);
  });
});
