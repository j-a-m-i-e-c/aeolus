// frontend/src/hooks/useReadOnlyDemo.ts
//
// Feature: public-demo-mode. Single source of truth for "this session should
// present admin surfaces read-only". True when the app is built as the public
// demo (VITE_PUBLIC_DEMO) and the current session is not an admin.
//
// The backend already blocks demo writes (the fail-closed PublicDemoGuard), so
// this hook is purely a UX signal: it lets admin pages hide their mutating
// controls (Add/Edit/Delete/Enable/config) so a visitor sees a clean, view-only
// version of the platform instead of buttons that would return
// "Unavailable in the public demo".

import { useAuthStore } from "../store/auth-store";
import { PUBLIC_DEMO } from "../lib/env";

/** True when admin surfaces should render read-only (public demo, non-admin). */
export function useReadOnlyDemo(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  return PUBLIC_DEMO && role !== "admin";
}
