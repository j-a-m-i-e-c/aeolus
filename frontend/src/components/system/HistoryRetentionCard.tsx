// Execution history is high-volume diagnostic data with configurable retention.
// Command evidence is retained indefinitely; there is deliberately no UI to prune it.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, History } from "lucide-react";
import { authFetch } from "../../lib/auth-fetch";
import { useReadOnlyDemo } from "../../hooks/useReadOnlyDemo";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
type Retention = { executionHistoryDays: number | null };
const description = "One entry per automation execution, including the trigger, outcome and duration.";
export function HistoryRetentionCard() {
  const readOnly = useReadOnlyDemo();
  const [saved, setSaved] = useState<number | null | undefined>(undefined);
  const [days, setDays] = useState("7");
  const [forever, setForever] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const apply = useCallback((r: Retention) => {
    setSaved(r.executionHistoryDays);
    setForever(r.executionHistoryDays === null);
    setDays(String(r.executionHistoryDays ?? 7));
  }, []);
  useEffect(() => {
    let cancelled = false;
    authFetch(`${API_URL}/api/system/retention`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json() as Retention;
        if (!cancelled) apply(body);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [apply]);
  if (saved === undefined) {
    return <div className="bg-surface border border-[#2A3441] rounded-xl p-4"><Header />
      <p className="text-xs text-[#6B7785]">{loadError ? "History retention settings could not be loaded." : "Loading…"}</p>
    </div>;
  }
  const parsed = Number(days);
  const valid = forever || (/^\d+$/.test(days.trim()) && Number.isInteger(parsed) && parsed >= MIN_RETENTION_DAYS && parsed <= MAX_RETENTION_DAYS);
  const next = forever ? null : parsed;
  const changed = valid && next !== saved;
  const shortens = next !== null && (saved === null || next < saved);
  const edit = () => { setConfirming(false); setError(null); setSuccess(false); };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await authFetch(`${API_URL}/api/system/retention`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionHistoryDays: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      apply(await res.json() as Retention);
      setConfirming(false); setSuccess(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };
  return <div className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-4">
    <div><Header />
      <p className="text-xs text-[#6B7785]">Execution logs are kept for seven days by default. Completed command evidence is preserved indefinitely and is not affected by this setting.</p>
      {readOnly && <p className="text-xs text-[#72B7E6] mt-1">Public demo: changes here cannot be saved.</p>}
    </div>
    <div className="space-y-1.5">
      <label htmlFor="retention-execution" className="text-xs text-[#6B7785] uppercase tracking-wider block">Execution history</label>
      <div className="flex flex-wrap items-center gap-3">
        <input id="retention-execution" type="number" min={1} max={3650} step={1} value={days}
          disabled={forever} aria-invalid={!valid} onChange={(e) => { setDays(e.target.value); edit(); }}
          className="w-24 text-sm bg-background border border-[#2A3441] rounded-lg px-3 py-1.5 text-[#E6EDF3] font-mono" />
        <span className="text-xs text-[#6B7785]">days</span>
        <label className="flex items-center gap-1.5 text-xs text-[#9AA6B2] cursor-pointer">
          <input type="checkbox" checked={forever} onChange={(e) => { setForever(e.target.checked); edit(); }} className="accent-primary" />
          Keep forever
        </label>
      </div>
      <p className="text-xs text-[#6B7785]">{description}</p>
      {!valid && <p className="text-xs text-[#EF4444]">Enter a whole number of days from 1 to 3650.</p>}
      {forever && <p className="text-xs text-[#F59E0B]">Kept forever, these logs grow without limit.</p>}
    </div>
    {confirming && <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg p-3 flex items-start gap-2">
      <AlertTriangle size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
      <div className="space-y-2"><p className="text-xs text-[#E6EDF3]">
        Saving immediately removes execution logs older than {next} day{next === 1 ? "" : "s"}. This cannot be undone. Command evidence is not deleted.
      </p><div className="flex items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className="bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 rounded-lg px-3 py-1.5 text-xs font-medium">Delete older logs and save</button>
        <button type="button" onClick={() => setConfirming(false)} className="text-xs text-[#9AA6B2] border border-[#2A3441] rounded-lg px-3 py-1.5">Cancel</button>
      </div></div>
    </div>}
    {error && <p className="text-xs text-[#EF4444]">{error}</p>}
    {!confirming && <div className="flex items-center gap-3">
      <button type="button" onClick={() => { if (readOnly) return; if (shortens) setConfirming(true); else void save(); }}
        disabled={readOnly || saving || !valid || !changed}
        className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50">
        <Check size={14} />{readOnly ? "Demo preview · not saved" : "Save"}
      </button>{success && <span className="text-xs text-[#22C55E]">Saved and applied</span>}
    </div>}
  </div>;
}
function Header() {
  return <div className="flex items-center gap-2 mb-2"><History size={14} className="text-primary" />
    <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">History retention</span>
  </div>;
}
