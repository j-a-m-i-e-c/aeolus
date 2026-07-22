// src/auth/pane-reference-extractor.ts — Pure derivation of automation→tab ownership from panes

/**
 * Minimal pane shape needed to derive automation ownership. This is the
 * server-side projection of a dashboard pane: which tab owns it, its type, and
 * its parsed config. Device-selection is not handled here — device exposure is
 * computed live by the Device_Exposure_Resolver, not persisted.
 */
export interface PaneRef {
  tabId: string;
  paneType: string;
  config: Record<string, unknown>;
}

/** The pane type that carries an explicit automation reference via `config.ruleId`. */
const AUTOMATION_PANE_TYPE = "automation";

/**
 * Derive the desired automation→tab assignment set from a set of panes.
 *
 * Only `automation` panes carry an explicit resource reference (`config.ruleId`);
 * every other pane type contributes nothing. A pane contributes
 * `{ tabId → ruleId }` only when its `config.ruleId` is a non-empty string.
 * Missing, empty, or non-string `ruleId` values reference no automation.
 *
 * When `existingAutomationIds` is provided, references to automations that are
 * not in that set (dangling references) are dropped, so callers such as the
 * backfill never create an assignment for an automation that no longer exists.
 *
 * The result maps each tab id to the distinct set of automation ids it exposes.
 * A tab with no automation references does not appear in the map.
 */
export function extractAutomationAssignments(
  panes: PaneRef[],
  existingAutomationIds?: ReadonlySet<string>,
): Map<string, Set<string>> {
  const byTab = new Map<string, Set<string>>();

  for (const pane of panes) {
    if (pane.paneType !== AUTOMATION_PANE_TYPE) {
      continue;
    }

    const ruleId = pane.config?.ruleId;
    if (typeof ruleId !== "string" || ruleId.length === 0) {
      continue;
    }

    if (existingAutomationIds && !existingAutomationIds.has(ruleId)) {
      continue;
    }

    let set = byTab.get(pane.tabId);
    if (!set) {
      set = new Set<string>();
      byTab.set(pane.tabId, set);
    }
    set.add(ruleId);
  }

  return byTab;
}
