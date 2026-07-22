// src/auth/pane-reference-extractor.test.ts — unit tests for automation ownership derivation
// Feature: resource-level-authorization

import { describe, it, expect } from "vitest";
import { extractAutomationAssignments, type PaneRef } from "./pane-reference-extractor.js";

describe("extractAutomationAssignments", () => {
  it("maps an automation pane's ruleId to its owning tab", () => {
    const panes: PaneRef[] = [
      { tabId: "tab-a", paneType: "automation", config: { ruleId: "auto-1" } },
    ];
    const result = extractAutomationAssignments(panes);
    expect([...result.get("tab-a") ?? []]).toEqual(["auto-1"]);
  });

  it("records the same automation on multiple tabs (one entry per distinct tab)", () => {
    const panes: PaneRef[] = [
      { tabId: "tab-a", paneType: "automation", config: { ruleId: "auto-1" } },
      { tabId: "tab-b", paneType: "automation", config: { ruleId: "auto-1" } },
    ];
    const result = extractAutomationAssignments(panes);
    expect([...result.get("tab-a") ?? []]).toEqual(["auto-1"]);
    expect([...result.get("tab-b") ?? []]).toEqual(["auto-1"]);
  });

  it("drops references to automations absent from the existing set", () => {
    const panes: PaneRef[] = [
      { tabId: "tab-a", paneType: "automation", config: { ruleId: "auto-1" } },
      { tabId: "tab-a", paneType: "automation", config: { ruleId: "ghost" } },
    ];
    const result = extractAutomationAssignments(panes, new Set(["auto-1"]));
    expect([...result.get("tab-a") ?? []]).toEqual(["auto-1"]);
  });

  it("ignores non-automation panes and malformed/empty ruleId", () => {
    const panes: PaneRef[] = [
      { tabId: "tab-a", paneType: "hue-control", config: {} },
      { tabId: "tab-a", paneType: "automation", config: { ruleId: "" } },
      { tabId: "tab-a", paneType: "automation", config: {} },
      { tabId: "tab-a", paneType: "automation", config: { ruleId: 42 } },
    ];
    const result = extractAutomationAssignments(panes);
    expect(result.size).toBe(0);
  });
});
