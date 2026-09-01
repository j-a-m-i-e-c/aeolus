// frontend/src/pages/GroupManagementPage.tsx — Admin group management UI

import { useState, useEffect, useCallback } from "react";
import { FolderKey, Plus, Pencil, Trash2, X, Loader2, Eye, MousePointer, PenTool } from "lucide-react";
import { authFetch } from "../lib/auth-fetch";
import { useDashboardStore } from "../store/dashboard-store";
import { useReadOnlyDemo } from "../hooks/useReadOnlyDemo";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionLevel = "read" | "interact" | "write";

interface TabAssignment {
  tabId: string;
  permission: PermissionLevel;
}

interface GroupRecord {
  id: string;
  name: string;
  tabAssignments: TabAssignment[];
  createdAt: number;
}

interface UserRecord {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
}

// ---------------------------------------------------------------------------
// Permission level helpers
// ---------------------------------------------------------------------------

const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  read: "Read",
  interact: "Interact",
  write: "Write",
};

const PERMISSION_ICONS: Record<PermissionLevel, typeof Eye> = {
  read: Eye,
  interact: MousePointer,
  write: PenTool,
};

const PERMISSION_COLORS: Record<PermissionLevel, string> = {
  read: "text-[#9AA6B2] bg-[#9AA6B2]/10 border-[#9AA6B2]/20",
  interact: "text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/20",
  write: "text-[#22C55E] bg-[#22C55E]/10 border-[#22C55E]/20",
};

// ---------------------------------------------------------------------------
// Tab Assignment Picker component
// ---------------------------------------------------------------------------

function TabAssignmentPicker({
  assignments,
  onChange,
}: {
  assignments: TabAssignment[];
  onChange: (assignments: TabAssignment[]) => void;
}) {
  const tabs = useDashboardStore((s) => s.tabs);

  const getAssignment = (tabId: string): TabAssignment | undefined =>
    assignments.find((a) => a.tabId === tabId);

  const toggleTab = (tabId: string) => {
    const existing = getAssignment(tabId);
    if (existing) {
      onChange(assignments.filter((a) => a.tabId !== tabId));
    } else {
      onChange([...assignments, { tabId, permission: "read" }]);
    }
  };

  const setPermission = (tabId: string, permission: PermissionLevel) => {
    onChange(
      assignments.map((a) => (a.tabId === tabId ? { ...a, permission } : a))
    );
  };

  return (
    <div className="space-y-2">
      <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Tab Assignments</label>
      {tabs.length === 0 ? (
        <p className="text-xs text-[#6B7785]">No tabs available</p>
      ) : (
        <div className="space-y-1.5">
          {tabs.map((tab) => {
            const assignment = getAssignment(tab.id);
            const isSelected = !!assignment;

            return (
              <div
                key={tab.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                  isSelected
                    ? "bg-elevated border-primary/30"
                    : "bg-background border-[#2A3441] hover:border-[#2A3441]/80"
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleTab(tab.id)}
                  className="accent-primary shrink-0"
                />

                {/* Tab name */}
                <span className={`flex-1 text-sm ${isSelected ? "text-[#E6EDF3]" : "text-[#6B7785]"}`}>
                  {tab.name}
                  {tab.pinned && <span className="text-[10px] text-[#6B7785] ml-1">(system)</span>}
                </span>

                {/* Permission level picker */}
                {isSelected && (
                  <div className="flex gap-1">
                    {(["read", "interact", "write"] as PermissionLevel[]).map((level) => {
                      const Icon = PERMISSION_ICONS[level];
                      const isActive = assignment?.permission === level;
                      return (
                        <button
                          key={level}
                          onClick={() => setPermission(tab.id, level)}
                          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                            isActive
                              ? PERMISSION_COLORS[level]
                              : "text-[#6B7785] bg-transparent border-transparent hover:bg-elevated"
                          }`}
                          title={PERMISSION_LABELS[level]}
                        >
                          <Icon size={10} />
                          {PERMISSION_LABELS[level]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Management Page
// ---------------------------------------------------------------------------

export function GroupManagementPage({ onGroupsChanged }: { onGroupsChanged?: () => void }) {
  const readOnly = useReadOnlyDemo();
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tabs = useDashboardStore((s) => s.tabs);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createAssignments, setCreateAssignments] = useState<TabAssignment[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editGroup, setEditGroup] = useState<GroupRecord | null>(null);
  const [editName, setEditName] = useState("");
  const [editAssignments, setEditAssignments] = useState<TabAssignment[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deleteGroup, setDeleteGroup] = useState<GroupRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchGroups = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/auth/groups`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      const data = await res.json();
      setGroups(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch groups");
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/auth/users`);
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchGroups(), fetchUsers()]).finally(() => setLoading(false));
  }, [fetchGroups, fetchUsers]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getTabName = (tabId: string): string => {
    const tab = tabs.find((t) => t.id === tabId);
    return tab?.name ?? "Unknown Tab";
  };

  const getUsersInGroup = (groupId: string): UserRecord[] => {
    return users.filter((u) => u.groupId === groupId);
  };

  // ---------------------------------------------------------------------------
  // Create group
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    setCreateError(null);
    if (!createName.trim()) {
      setCreateError("Group name is required");
      return;
    }

    setCreating(true);
    try {
      const res = await authFetch(`${API_URL}/api/auth/groups`, {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          tabAssignments: createAssignments,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create group" }));
        throw new Error(body.error || "Failed to create group");
      }

      setCreateName("");
      setCreateAssignments([]);
      setShowCreateForm(false);
      await fetchGroups();
      onGroupsChanged?.();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit group
  // ---------------------------------------------------------------------------

  const openEditModal = (group: GroupRecord) => {
    setEditGroup(group);
    setEditName(group.name);
    setEditAssignments([...group.tabAssignments]);
    setEditError(null);
  };

  const handleEdit = async () => {
    if (!editGroup) return;
    setEditError(null);

    if (!editName.trim()) {
      setEditError("Group name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/api/auth/groups/${editGroup.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editName.trim(),
          tabAssignments: editAssignments,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update group" }));
        throw new Error(body.error || "Failed to update group");
      }

      setEditGroup(null);
      await fetchGroups();
      onGroupsChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete group
  // ---------------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteGroup) return;
    setDeleteError(null);
    setDeleting(true);

    try {
      const res = await authFetch(`${API_URL}/api/auth/groups/${deleteGroup.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to delete group" }));
        throw new Error(body.error || "Failed to delete group");
      }

      setDeleteGroup(null);
      await Promise.all([fetchGroups(), fetchUsers()]);
      onGroupsChanged?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete group");
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-[#6B7785]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl px-4 py-3 text-sm text-[#EF4444]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderKey size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Groups</h2>
        </div>
        <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
          >
            <Plus size={12} />
            Add Group
          </button>
      </div>

      {/* Create group form */}
      {showCreateForm && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-[#E6EDF3]">Create Group</h3>

          <div>
            <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Group Name</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Family, Guests"
              className="w-full max-w-xs px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <TabAssignmentPicker
            assignments={createAssignments}
            onChange={setCreateAssignments}
          />

          {createError && (
            <p className="text-xs text-[#EF4444]">{createError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || readOnly}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {creating && <Loader2 size={12} className="animate-spin" />}
              {readOnly ? "Demo preview · not saved" : "Create"}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setCreateName("");
                setCreateAssignments([]);
                setCreateError(null);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Group list */}
      {groups.length === 0 ? (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-8 text-center text-[#6B7785] text-sm">
          No groups created yet. Create a group to assign tab permissions to users.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupUsers = getUsersInGroup(group.id);
            return (
              <div
                key={group.id}
                className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3"
              >
                {/* Group header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderKey size={14} className="text-primary" />
                    <span className="text-sm font-semibold text-[#E6EDF3]">{group.name}</span>
                    {groupUsers.length > 0 && (
                      <span className="text-[10px] text-[#6B7785] bg-[#2A3441] px-1.5 py-0.5 rounded-full">
                        {groupUsers.length} user{groupUsers.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(group)}
                      className="p-1.5 rounded-lg text-[#6B7785] hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Edit group"
                    >
                      <Pencil size={14} />
                    </button>
                    {!readOnly && (
                      <button
                        onClick={() => setDeleteGroup(group)}
                        className="p-1.5 rounded-lg text-[#6B7785] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                        title="Delete group"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tab assignments visual indicator */}
                {group.tabAssignments.length === 0 ? (
                  <p className="text-xs text-[#6B7785]">No tabs assigned</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {group.tabAssignments.map((assignment) => {
                      const Icon = PERMISSION_ICONS[assignment.permission];
                      return (
                        <span
                          key={assignment.tabId}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border ${PERMISSION_COLORS[assignment.permission]}`}
                        >
                          <Icon size={10} />
                          {getTabName(assignment.tabId)}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Members list */}
                {groupUsers.length > 0 && (
                  <div className="text-xs text-[#6B7785]">
                    Members: {groupUsers.map((u) => u.username).join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit group modal */}
      {editGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-[#2A3441] rounded-xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#E6EDF3]">Edit Group: {editGroup.name}</h3>
              <button
                onClick={() => setEditGroup(null)}
                className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Group Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
                />
              </div>

              <TabAssignmentPicker
                assignments={editAssignments}
                onChange={setEditAssignments}
              />
            </div>

            {editError && (
              <p className="text-xs text-[#EF4444]">{editError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditGroup(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={saving || readOnly}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {readOnly ? "Demo preview · not saved" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-[#2A3441] rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-base font-semibold text-[#E6EDF3]">Delete Group</h3>
            <p className="text-sm text-[#9AA6B2]">
              Are you sure you want to delete <span className="text-[#E6EDF3] font-medium">{deleteGroup.name}</span>?
            </p>

            {/* Warning about affected users */}
            {getUsersInGroup(deleteGroup.id).length > 0 && (
              <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg px-3 py-2 text-xs text-[#F59E0B]">
                ⚠ This group has {getUsersInGroup(deleteGroup.id).length} user{getUsersInGroup(deleteGroup.id).length !== 1 ? "s" : ""} assigned.
                They will lose all tab access until reassigned to another group.
              </div>
            )}

            {deleteError && (
              <p className="text-xs text-[#EF4444]">{deleteError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setDeleteGroup(null); setDeleteError(null); }}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-[#EF4444]/20 text-[#EF4444] hover:bg-[#EF4444]/30 transition-colors disabled:opacity-50"
              >
                {deleting && <Loader2 size={12} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
