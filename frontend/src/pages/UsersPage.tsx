// frontend/src/pages/UsersPage.tsx — Dedicated admin page for user and group management

import { useAuthStore } from "../store/auth-store";
import { GroupManagementPage } from "./GroupManagementPage";
import { UserManagementPage } from "./UserManagementPage";

export function UsersPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm">Access denied — admin only</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-6 px-4">
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3] mb-1">Users & Groups</h1>
        <p className="text-sm text-[#6B7785]">Manage user accounts and permission groups</p>
      </div>

      <GroupManagementPage />
      <UserManagementPage />
    </div>
  );
}
