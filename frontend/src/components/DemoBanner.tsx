// frontend/src/components/DemoBanner.tsx — persistent public-demo banner.
//
// Rendered only when the frontend runs in public demo mode (VITE_PUBLIC_DEMO).
// Communicates that the environment is simulated, shared, and reset nightly, and
// offers a way back to the marketing site (Req 10.2).

import { PUBLIC_DEMO } from "../lib/env";

export function DemoBanner() {
  if (!PUBLIC_DEMO) return null;

  return (
    <div
      role="status"
      className="w-full bg-[#3BA4FF]/10 border-b border-[#3BA4FF]/30 text-[#9AA6B2] text-[10px] sm:text-[11px] px-2 sm:px-3 py-1.5 flex items-center justify-center gap-1.5 sm:gap-2"
    >
      <span className="font-semibold text-[#3BA4FF]">Public demo</span>
      <span className="text-[#6B7785]">·</span>
      <span className="hidden sm:inline">Simulated devices</span>
      <span className="hidden sm:inline text-[#6B7785]">·</span>
      <span className="hidden sm:inline">Shared environment</span>
      <span className="hidden sm:inline text-[#6B7785]">·</span>
      <span>Resets nightly</span>
      <a
        href="https://aeolus.com.au"
        className="hidden sm:inline ml-1 text-[#3BA4FF] hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        aeolus.com.au
      </a>
    </div>
  );
}
