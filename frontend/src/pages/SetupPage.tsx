// frontend/src/pages/SetupPage.tsx — First-run admin setup page

import { useState, type FormEvent } from "react";
import { useAuthStore } from "../store/auth-store";

export function SetupPage() {
  const setup = useAuthStore((s) => s.setup);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      await setup(username, password);
      // On success, the auth store sets isAuthenticated = true,
      // which triggers the app to show the dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
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
          <p className="text-sm text-[#9AA6B2] mt-2">Welcome to Aeolus</p>
        </div>

        {/* Setup Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-[#121821] rounded-2xl p-6 border border-[#2A3441] shadow-lg"
        >
          {/* Welcome Message */}
          <div className="mb-5 text-center">
            <h2 className="text-lg font-medium text-[#E6EDF3] mb-1">
              Create Admin Account
            </h2>
            <p className="text-xs text-[#6B7785] leading-relaxed">
              Set up your administrator account to get started. This account has
              full control over the platform.
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#EF4444] text-sm">
              {error}
            </div>
          )}

          {/* Username Field */}
          <div className="mb-4">
            <label
              htmlFor="setup-username"
              className="block text-sm font-medium text-[#9AA6B2] mb-1.5"
            >
              Username
            </label>
            <input
              id="setup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] text-sm placeholder-[#6B7785] focus:outline-none focus:border-[#3BA4FF] focus:ring-1 focus:ring-[#3BA4FF] transition-colors disabled:opacity-50"
              placeholder="Choose a username"
            />
          </div>

          {/* Password Field */}
          <div className="mb-4">
            <label
              htmlFor="setup-password"
              className="block text-sm font-medium text-[#9AA6B2] mb-1.5"
            >
              Password
            </label>
            <input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] text-sm placeholder-[#6B7785] focus:outline-none focus:border-[#3BA4FF] focus:ring-1 focus:ring-[#3BA4FF] transition-colors disabled:opacity-50"
              placeholder="Minimum 8 characters"
            />
            <p className="mt-1 text-xs text-[#6B7785]">
              Must be at least 8 characters
            </p>
          </div>

          {/* Confirm Password Field */}
          <div className="mb-6">
            <label
              htmlFor="setup-confirm-password"
              className="block text-sm font-medium text-[#9AA6B2] mb-1.5"
            >
              Confirm Password
            </label>
            <input
              id="setup-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441] text-[#E6EDF3] text-sm placeholder-[#6B7785] focus:outline-none focus:border-[#3BA4FF] focus:ring-1 focus:ring-[#3BA4FF] transition-colors disabled:opacity-50"
              placeholder="Re-enter password"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-[#3BA4FF] text-white text-sm font-medium hover:bg-[#3BA4FF]/90 focus:outline-none focus:ring-2 focus:ring-[#3BA4FF]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating account…" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
