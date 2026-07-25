// frontend/src/pages/LoginPage.tsx — Login page with Aeolus design system

import { useState, type FormEvent } from "react";
import { useAuthStore } from "../store/auth-store";

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }

    setSubmitting(true);
    try {
      await login(username, password);
      // Navigate to dashboard after successful login so the user doesn't land
      // on a stale URL (e.g. /security) they may not have access to.
      window.history.replaceState(null, "", "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F14] px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <img src="/logo.png" alt="Aeolus" className="w-10 h-10" />
            <h1 className="text-2xl font-semibold text-[#E6EDF3] font-[Inter]">
              Aeolus
            </h1>
          </div>
          <p className="text-sm text-[#6B7785]">Sign in to your dashboard</p>
        </div>

        {/* Login Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-[#121821] rounded-2xl p-6 border border-[#2A3441] shadow-lg"
        >
          {/* Error Message */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#EF4444] text-sm">
              {error}
            </div>
          )}

          {/* Username Field */}
          <div className="mb-4">
            <label
              htmlFor="login-username"
              className="block text-sm font-medium text-[#9AA6B2] mb-1.5"
            >
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] text-sm placeholder-[#6B7785] focus:outline-none focus:border-[#3BA4FF] focus:ring-1 focus:ring-[#3BA4FF] transition-colors disabled:opacity-50"
              placeholder="Enter username"
            />
          </div>

          {/* Password Field */}
          <div className="mb-6">
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-[#9AA6B2] mb-1.5"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] text-sm placeholder-[#6B7785] focus:outline-none focus:border-[#3BA4FF] focus:ring-1 focus:ring-[#3BA4FF] transition-colors disabled:opacity-50"
              placeholder="Enter password"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-[#3BA4FF] text-white text-sm font-medium hover:bg-[#3BA4FF]/90 focus:outline-none focus:ring-2 focus:ring-[#3BA4FF]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
