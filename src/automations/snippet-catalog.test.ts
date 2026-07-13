// src/automations/snippet-catalog.test.ts — Unit tests for snippet catalog builder

import { describe, it, expect } from "vitest";
import { buildSnippetCatalog } from "./snippet-catalog.js";
import type { ConnectorRegistry } from "../connectors/connector-registry.js";

function createMockRegistry(modules: Array<{ metadata: any; snippets?: any[] }> = []): ConnectorRegistry {
  const moduleMap = new Map<string, any>();
  for (const mod of modules) {
    moduleMap.set(mod.metadata.id, mod);
  }

  return {
    listAvailable: () => modules.map((m) => ({ metadata: m.metadata, configSchema: [] })),
    getModule: (id: string) => moduleMap.get(id),
  } as unknown as ConnectorRegistry;
}

describe("buildSnippetCatalog", () => {
  it("returns platform snippets in logic mode with no connectors", () => {
    const registry = createMockRegistry();
    const catalog = buildSnippetCatalog(registry, "logic");
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0].category).toBe("MQTT");
  });

  it("returns empty array in ui mode with no connectors", () => {
    const registry = createMockRegistry();
    const catalog = buildSnippetCatalog(registry, "ui");
    expect(catalog).toEqual([]);
  });

  it("includes connector snippets in logic mode", () => {
    const registry = createMockRegistry([
      {
        metadata: { id: "hue", displayName: "Philips Hue", icon: "lightbulb" },
        snippets: [
          { id: "toggle", name: "Toggle Light", description: "Toggle a Hue light", code: "hue.toggle()" },
        ],
      },
    ]);
    const catalog = buildSnippetCatalog(registry, "logic");
    const hueGroup = catalog.find((g) => g.category === "Philips Hue");
    expect(hueGroup).toBeDefined();
    expect(hueGroup!.snippets[0].id).toBe("hue-toggle");
    expect(hueGroup!.snippets[0].name).toBe("Toggle Light");
  });

  it("filters connector snippets by mode", () => {
    const registry = createMockRegistry([
      {
        metadata: { id: "hue", displayName: "Philips Hue", icon: "lightbulb" },
        snippets: [
          { id: "toggle", name: "Toggle Light", description: "Logic snippet", code: "hue.toggle()", mode: "logic" },
          { id: "widget", name: "Light Widget", description: "UI snippet", code: "<LightWidget />", mode: "ui" },
        ],
      },
    ]);

    const logicCatalog = buildSnippetCatalog(registry, "logic");
    const hueLogic = logicCatalog.find((g) => g.category === "Philips Hue");
    expect(hueLogic).toBeDefined();
    expect(hueLogic!.snippets).toHaveLength(1);
    expect(hueLogic!.snippets[0].name).toBe("Toggle Light");

    const uiCatalog = buildSnippetCatalog(registry, "ui");
    const hueUi = uiCatalog.find((g) => g.category === "Philips Hue");
    expect(hueUi).toBeDefined();
    expect(hueUi!.snippets).toHaveLength(1);
    expect(hueUi!.snippets[0].name).toBe("Light Widget");
  });

  it("skips connectors with no snippets", () => {
    const registry = createMockRegistry([
      {
        metadata: { id: "kasa", displayName: "TP-Link Kasa", icon: "plug" },
        snippets: undefined,
      },
    ]);
    const catalog = buildSnippetCatalog(registry, "logic");
    const kasaGroup = catalog.find((g) => g.category === "TP-Link Kasa");
    expect(kasaGroup).toBeUndefined();
  });

  it("skips connectors with empty snippets array", () => {
    const registry = createMockRegistry([
      {
        metadata: { id: "kasa", displayName: "TP-Link Kasa", icon: "plug" },
        snippets: [],
      },
    ]);
    const catalog = buildSnippetCatalog(registry, "logic");
    const kasaGroup = catalog.find((g) => g.category === "TP-Link Kasa");
    expect(kasaGroup).toBeUndefined();
  });

  it("does not include connector group when all snippets are filtered out by mode", () => {
    const registry = createMockRegistry([
      {
        metadata: { id: "hue", displayName: "Philips Hue", icon: "lightbulb" },
        snippets: [
          { id: "widget", name: "Widget", description: "UI only", code: "<W />", mode: "ui" },
        ],
      },
    ]);
    const catalog = buildSnippetCatalog(registry, "logic");
    const hueGroup = catalog.find((g) => g.category === "Philips Hue");
    expect(hueGroup).toBeUndefined();
  });

  it("defaults mode to logic when not specified", () => {
    const registry = createMockRegistry();
    const catalog = buildSnippetCatalog(registry);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0].category).toBe("MQTT");
  });
});
