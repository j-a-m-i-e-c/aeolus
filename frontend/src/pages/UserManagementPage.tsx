// frontend/src/pages/UserManagementPage.tsx — Admin user management UI

import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Pencil, Trash2, X, Loader2, Shield, User } from "lucide-react";
import { authFetch } from "../lib/auth-fetch";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRecord {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
  createdAt: number;
}

interface GroupRecord {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// User Management Page
// ---------------------------------------------------------------------------

export function UserManagementPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createGroupId, setCreateGroupId] = useState<string>("");
  const [createRole, setCreateRole] = useState<"admin" | "user">("user");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [editGroupId, setEditGroupId] = useState<string>("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deleteUser, setDeleteUser] = useState<UserRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/auth/users`);
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/auth/groups`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      const data = await res.json();
      setGroups(data);
    } catch {
      // Groups may not exist yet — that's fine
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchGroups()]).finally(() => setLoading(false));
  }, [fetchUsers, fetchGroups]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getGroupName = (groupId: string | null): string => {
    if (!groupId) return "No access";
    const group = groups.find((g) => g.id === groupId);
    return group?.name ?? "Unknown";
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // ---------------------------------------------------------------------------
  // Create user
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    setCreateError(null);
    if (!createUsername.trim()) {
      setCreateError("Username is required");
      return;
    }
    if (createPassword.length < 8) {
      setCreateError("Password must be at least 8 characters");
      return;
    }

    setCreating(true);
    try {
      const res = await authFetch(`${API_URL}/api/auth/users`, {
        method: "POST",
        body: JSON.stringify({
          username: createUsername.trim(),
          password: createPassword,
          groupId: createGroupId || null,
          role: createRole,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create user" }));
        throw new Error(body.error || "Failed to create user");
      }

      // Reset form and refresh
      setCreateUsername("");
      setCreatePassword("");
      setCreateGroupId("");
      setCreateRole("user");
      setShowCreateForm(false);
      await fetchUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit user
  // ---------------------------------------------------------------------------

  const openEditModal = (user: UserRecord) => {
    fetchGroups();
    setEditUser(user);
    setEditGroupId(user.groupId ?? "");
    setEditRole(user.role);
    setEditPassword("");
    setEditError(null);
  };

  const handleEdit = async () => {
    if (!editUser) return;
    setEditError(null);

    if (editPassword && editPassword.length < 8) {
      setEditError("Password must be at least 8 characters");
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editGroupId !== (editUser.groupId ?? "")) {
        updates.groupId = editGroupId || null;
      }
      if (editRole !== editUser.role) {
        updates.role = editRole;
      }
      if (editPassword) {
        updates.password = editPassword;
      }

      if (Object.keys(updates).length === 0) {
        setEditUser(null);
        return;
      }

      const res = await authFetch(`${API_URL}/api/auth/users/${editUser.id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update user" }));
        throw new Error(body.error || "Failed to update user");
      }

      setEditUser(null);
      await fetchUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete user
  // ---------------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleteError(null);
    setDeleting(true);

    try {
      const res = await authFetch(`${API_URL}/api/auth/users/${deleteUser.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to delete user" }));
        throw new Error(body.error || "Failed to delete user");
      }

      setDeleteUser(null);
      await fetchUsers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete user");
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
          <Users size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Users</h2>
        </div>
        <button
          onClick={() => { fetchGroups(); setShowCreateForm(!showCreateForm); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
        >
          <Plus size={12} />
          Add User
        </button>
      </div>

      {/* Create user form */}
      {showCreateForm && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-[#E6EDF3]">Create User</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Username</label>
              <input
                type="text"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="username"
                className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Password</label>
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="min 8 characters"
                className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Role</label>
              <select
                aria-label="Role"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as "admin" | "user")}
                className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              {createRole === "admin" && (
                <p className="mt-1 text-[10px] text-[#6B7785]">Admins have full system-wide access and bypass tab permissions.</p>
              )}
            </div>
            <div>
              <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Group</label>
              <select
                value={createGroupId}
                onChange={(e) => setCreateGroupId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">None (no tab access)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              {!createGroupId && createRole !== "admin" && (
                <p className="mt-1 text-[10px] text-[#6B7785]">User will not have access to any tabs until assigned a group.</p>
              )}
            </div>
          </div>

          {createError && (
            <p className="text-xs text-[#EF4444]">{createError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {creating && <Loader2 size={12} className="animate-spin" />}
              Create
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setCreateUsername("");
                setCreatePassword("");
                setCreateGroupId("");
                setCreateError(null);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* User list table */}
      <div className="bg-surface border border-[#2A3441] rounded-xl overflow-hidden">
        {users.length === 0 ? (
          <div className="text-center py-8 text-[#6B7785] text-sm">No users found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2A3441]">
                <th className="text-left px-4 py-3 text-[10px] text-[#6B7785] uppercase font-semibold tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-[10px] text-[#6B7785] uppercase font-semibold tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-[10px] text-[#6B7785] uppercase font-semibold tracking-wider">Group</th>
                <th className="text-left px-4 py-3 text-[10px] text-[#6B7785] uppercase font-semibold tracking-wider">Created</th>
                <th className="text-right px-4 py-3 text-[10px] text-[#6B7785] uppercase font-semibold tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A3441]/50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-elevated/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {u.role === "admin" ? (
                        <Shield size={14} className="text-primary shrink-0" />
                      ) : (
                        <User size={14} className="text-[#6B7785] shrink-0" />
                      )}
                      <span className="text-[#E6EDF3] font-medium">{u.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      u.role === "admin"
                        ? "bg-primary/20 text-primary"
                        : "bg-[#2A3441] text-[#9AA6B2]"
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#9AA6B2]">
                    {u.groupId ? (
                      getGroupName(u.groupId)
                    ) : (
                      <span className="text-[#6B7785] italic">No access</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6B7785]">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-1.5 rounded-lg text-[#6B7785] hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Edit user"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteUser(u)}
                        className="p-1.5 rounded-lg text-[#6B7785] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                        title="Delete user"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-[#2A3441] rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#E6EDF3]">Edit User: {editUser.username}</h3>
              <button
                onClick={() => setEditUser(null)}
                className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Role</label>
                <select
                  aria-label="Role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as "admin" | "user")}
                  className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                {editRole === "admin" && (
                  <p className="mt-1 text-[10px] text-[#6B7785]">Admins have full system-wide access and bypass tab permissions.</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Group Assignment</label>
                <select
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">None (no tab access)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                {!editGroupId && editRole !== "admin" && (
                  <p className="mt-1 text-[10px] text-[#6B7785]">User will not have access to any tabs.</p>
                )}
              </div>

              <div>
                <label className="block text-[10px] text-[#6B7785] uppercase mb-1">Reset Password</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                  className="w-full px-3 py-2 text-sm bg-background border border-[#2A3441] rounded-lg text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            {editError && (
              <p className="text-xs text-[#EF4444]">{editError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditUser(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-[#2A3441] rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-base font-semibold text-[#E6EDF3]">Delete User</h3>
            <p className="text-sm text-[#9AA6B2]">
              Are you sure you want to delete <span className="text-[#E6EDF3] font-medium">{deleteUser.username}</span>?
              This action cannot be undone.
            </p>

            {deleteError && (
              <p className="text-xs text-[#EF4444]">{deleteError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setDeleteUser(null); setDeleteError(null); }}
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
