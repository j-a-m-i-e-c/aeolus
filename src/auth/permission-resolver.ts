// src/auth/permission-resolver.ts — Effective permission for a (user, resource) pair

import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "../db/database.js";
import { PERMISSION_RANK, type PermissionLevel } from "./permission-service.js";
import type { ResourceOwnershipStore } from "./resource-ownership-store.js";
import type { DeviceExposureResolver } from "./device-exposure-resolver.js";

export type ResourceKind = "device" | "automation";
export type EffectivePermission = PermissionLevel | "none";

/**
 * Computes a user's effective permission for a target resource from the tabs that
 * actually expose that resource, resolved server-side by kind: automations via
 * the Resource_Ownership_Store, devices via the (live) Device_Exposure_Resolver.
 * It never reads a tab identifier from the request.
 */
export interface PermissionResolver {
  /**
   * The most-permissive level the user's group holds across the resource's
   * exposing tabs; `none` if the user has no group, the group holds nothing on
   * any exposing tab, or the resource has no exposing tabs.
   */
  effectivePermission(
    userId: string,
    kind: ResourceKind,
    resourceId: string,
  ): EffectivePermission;

  /** True iff `effectivePermission(...)` rank is at least the required rank. */
  hasResourcePermission(
    userId: string,
    kind: ResourceKind,
    resourceId: string,
    required: PermissionLevel,
  ): boolean;

  /**
   * For a set of resources of one kind, return only those the user can reach at
   * >= `required`. Used to filter list endpoints. Loads the user's group tab
   * permissions once and batches exposing-tab lookups.
   */
  filterByPermission(
    userId: string,
    kind: ResourceKind,
    resourceIds: string[],
    required: PermissionLevel,
  ): string[];
}

/** `none` ranks below every real permission level. */
const NONE_RANK = 0;

interface UserGroupRow {
  group_id: string | null;
}

/**
 * Create a PermissionResolver from the automation ownership store and the live
 * device exposure resolver. Reuses `getGroupPermissions` and `PERMISSION_RANK`
 * from `permission-service.ts` rather than duplicating rank logic.
 */
export function createPermissionResolver(
  ownershipStore: ResourceOwnershipStore,
  deviceExposureResolver: DeviceExposureResolver,
  dbOverride?: DatabaseType,
): PermissionResolver {
  const resolveDb = (): DatabaseType => dbOverride ?? getDatabase();

  function getUserGroupId(userId: string): string | null {
    const db = resolveDb();
    const row = db
      .prepare("SELECT group_id FROM users WHERE id = ?")
      .get(userId) as UserGroupRow | undefined;
    return row?.group_id ?? null;
  }

  /** Map tab id → permission rank for the user's group. */
  function groupRankByTab(groupId: string): Map<string, number> {
    const db = resolveDb();
    const rows = db
      .prepare("SELECT tab_id, permission FROM group_tab_assignments WHERE group_id = ?")
      .all(groupId) as { tab_id: string; permission: PermissionLevel }[];
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.tab_id, PERMISSION_RANK[row.permission]);
    }
    return map;
  }

  function exposingTabs(kind: ResourceKind, resourceId: string): string[] {
    return kind === "automation"
      ? ownershipStore.getExposingTabs(resourceId)
      : deviceExposureResolver.getExposingTabs(resourceId);
  }

  function maxRankOverTabs(
    tabs: string[],
    rankByTab: Map<string, number>,
  ): number {
    let best = NONE_RANK;
    for (const tabId of tabs) {
      const rank = rankByTab.get(tabId);
      if (rank !== undefined && rank > best) {
        best = rank;
      }
    }
    return best;
  }

  function rankToPermission(rank: number): EffectivePermission {
    for (const level of ["write", "interact", "read"] as PermissionLevel[]) {
      if (PERMISSION_RANK[level] === rank) {
        return level;
      }
    }
    return "none";
  }

  function effectivePermission(
    userId: string,
    kind: ResourceKind,
    resourceId: string,
  ): EffectivePermission {
    const groupId = getUserGroupId(userId);
    if (groupId === null) {
      return "none";
    }
    const rankByTab = groupRankByTab(groupId);
    const rank = maxRankOverTabs(exposingTabs(kind, resourceId), rankByTab);
    return rankToPermission(rank);
  }

  function hasResourcePermission(
    userId: string,
    kind: ResourceKind,
    resourceId: string,
    required: PermissionLevel,
  ): boolean {
    const groupId = getUserGroupId(userId);
    if (groupId === null) {
      return false;
    }
    const rankByTab = groupRankByTab(groupId);
    const rank = maxRankOverTabs(exposingTabs(kind, resourceId), rankByTab);
    return rank >= PERMISSION_RANK[required];
  }

  function filterByPermission(
    userId: string,
    kind: ResourceKind,
    resourceIds: string[],
    required: PermissionLevel,
  ): string[] {
    if (resourceIds.length === 0) {
      return [];
    }
    const groupId = getUserGroupId(userId);
    if (groupId === null) {
      return [];
    }
    const rankByTab = groupRankByTab(groupId);
    const requiredRank = PERMISSION_RANK[required];

    const exposingByResource =
      kind === "automation"
        ? ownershipStore.getExposingTabsBatch(resourceIds)
        : deviceExposureResolver.getExposingTabsBatch(resourceIds);

    return resourceIds.filter((id) => {
      const tabs = exposingByResource.get(id) ?? [];
      return maxRankOverTabs(tabs, rankByTab) >= requiredRank;
    });
  }

  return {
    effectivePermission,
    hasResourcePermission,
    filterByPermission,
  };
}
