// frontend/src/components/panes/hue/SearchLightsButton.tsx — Zigbee light search UI

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2, CheckCircle2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface SearchState {
  active: boolean;
  startedAt: number | null;
  newLights: Array<{ id: string; name: string }>;
  error: string | null;
}

interface Props {
  connectorId: string;
}

export function SearchLightsButton({ connectorId }: Props) {
  const [searching, setSearching] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [results, setResults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startSearch = async () => {
    setSearching(true);
    setResults(null);
    setError(null);
    setCountdown(40);

    try {
      const res = await fetch(`${API_URL}/api/connectors/${connectorId}/search-lights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Search failed" }));
        setError(body.error || `Search failed: ${res.status}`);
        setSearching(false);
        return;
      }

      // Start countdown timer
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Poll for status every 3 seconds
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(
            `${API_URL}/api/connectors/${connectorId}/search-lights/status`,
          );
          if (statusRes.ok) {
            const status: SearchState = await statusRes.json();
            if (!status.active) {
              cleanup();
              setSearching(false);
              setResults(status.newLights);
              if (status.error) {
                setError(status.error);
              }
              // Trigger re-discovery so new lights appear in the UI
              try {
                await fetch(`${API_URL}/api/connectors/${connectorId}/retry`, { method: "POST" });
              } catch {}
            }
          }
        } catch {}
      }, 3000);

      // Safety timeout — stop after 50s regardless
      setTimeout(() => {
        if (searching) {
          cleanup();
          setSearching(false);
          if (!results) {
            setResults([]);
          }
        }
      }, 50000);
    } catch (err) {
      setError((err as Error).message);
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={startSearch}
        disabled={searching}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
          searching
            ? "bg-[#6B7785]/20 text-[#6B7785] cursor-not-allowed"
            : "bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/30"
        }`}
      >
        {searching ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Searching... {countdown > 0 && `(${countdown}s)`}
          </>
        ) : (
          <>
            <Search size={12} />
            Search for new lights
          </>
        )}
      </button>

      {error && (
        <p className="text-[10px] text-[#EF4444]">{error}</p>
      )}

      {results !== null && !searching && (
        <div className="text-[10px]">
          {results.length > 0 ? (
            <div className="flex items-start gap-1.5 text-[#22C55E]">
              <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Found {results.length} new light{results.length !== 1 ? "s" : ""}:</p>
                <ul className="mt-0.5 space-y-0.5 text-[#E6EDF3]">
                  {results.map((l) => (
                    <li key={l.id}>{l.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-[#6B7785]">No new lights found.</p>
          )}
        </div>
      )}
    </div>
  );
}
