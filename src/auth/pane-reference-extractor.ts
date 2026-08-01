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

/** The pane type that carries an explicit collection reference via `config.collection`. */
const DATA_COLLECTION_PANE_TYPE = "data-collection";

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

/**
 * Derive the desired collection→tab assignment set from a set of panes.
 *
 * Only `data-collection` panes carry an explicit collection reference
 * (`config.collection`); every other pane type contributes nothing. A pane
 * contributes `{ tabId → collection }` only when its `config.collection` is a
 * non-empty string. Unlike automations there is no "existing ids" filter: a
 * pane may reference a not-yet-populated collection, and events only fire for
 * collections that exist, so a dangling reference simply never scopes anything.
 *
 * The result maps each tab id to the distinct set of collection names it
 * surfaces. A tab with no collection references does not appear in the map.
 */
export function extractCollectionAssignments(panes: PaneRef[]): Map<string, Set<string>> {
  const byTab = new Map<string, Set<string>>();

  for (const pane of panes) {
    if (pane.paneType !== DATA_COLLECTION_PANE_TYPE) {
      continue;
    }

    const collection = pane.config?.collection;
    if (typeof collection !== "string" || collection.length === 0) {
      continue;
    }

    let set = byTab.get(pane.tabId);
    if (!set) {
      set = new Set<string>();
      byTab.set(pane.tabId, set);
    }
    set.add(collection);
  }

  return byTab;
}
