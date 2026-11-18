// frontend/src/components/system/HistoryRetentionCard.tsx — how long history is kept.
//
// Two admin settings (GET/PUT /api/system/retention): execution history, one row per
// automation run, and command history, the audit trail of what devices were told to
// do. Each is a number of days or "keep forever". The backend applies a change straight
// away, so shortening a period asks for confirmation first: older history is deleted
// when the change is saved.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, History } from "lucide-react";
import { authFetch } from "../../lib/auth-fetch";
import { useReadOnlyDemo } from "../../hooks/useReadOnlyDemo";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

// Match src/core/retention-settings.ts; the backend validates the same range.
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

type HistoryKey = "executionHistoryDays" | "commandHistoryDays";
type Retention = Record<HistoryKey, number | null>;
interface Draft {
  forever: boolean;
  days: string;
}

const HISTORIES: Array<{ key: HistoryKey; label: string; description: string }> = [
  {
    key: "executionHistoryDays",
    label: "Execution history",
    description: "One entry each time an automation runs: what triggered it, what it did and whether it succeeded.",
  },
  {
    key: "commandHistoryDays",
    label: "Command history",
    description:
      "Every command sent to a device and the evidence that it took effect. Commands still waiting for confirmation are never removed.",
  },
];

const toDraft = (days: number | null): Draft => ({ forever: days === null, days: days === null ? "" : String(days) });

/** The draft as a period in days, null for forever, or undefined when it is not a valid entry. */
function parseDraft(draft: Draft): number | null | undefined {
  if (draft.forever) return null;
  if (!/^\d+$/.test(draft.days.trim())) return undefined;
  const days = Number(draft.days);
  return days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS ? days : undefined;
}

/** True when `next` keeps less history than `current`. */
const shortens = (current: number | null, next: number | null) => next !== null && (current === null || next < current);

const period = (days: number | null) => (days === null ? "forever" : `${days} day${days === 1 ? "" : "s"}`);

export function HistoryRetentionCard() {
  const readOnly = useReadOnlyDemo();
  const [saved, setSaved] = useState<Retention | null>(null);
  const [drafts, setDrafts] = useState<Record<HistoryKey, Draft> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const apply = useCallback((retention: Retention) => {
    setSaved(retention);
    setDrafts({
      executionHistoryDays: toDraft(retention.executionHistoryDays),
      commandHistoryDays: toDraft(retention.commandHistoryDays),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${API_URL}/api/system/retention`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Retention;
        if (!cancelled) apply(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  if (!saved || !drafts) {
    return (
      <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
        <Header />
        <p className="text-xs text-[#6B7785]">{loadError ? "History retention settings could not be loaded." : "Loading…"}</p>
      </div>
    );
  }

  const next: Partial<Record<HistoryKey, number | null | undefined>> = {
    executionHistoryDays: parseDraft(drafts.executionHistoryDays),
    commandHistoryDays: parseDraft(drafts.commandHistoryDays),
  };
  const valid = HISTORIES.every(({ key }) => next[key] !== undefined);
  const changed = HISTORIES.filter(({ key }) => next[key] !== undefined && next[key] !== saved[key]);
  const shortened = changed.filter(({ key }) => shortens(saved[key], next[key] as number | null));

  const edit = (key: HistoryKey, draft: Partial<Draft>) => {
    setDrafts({ ...drafts, [key]: { ...drafts[key], ...draft } });
    setConfirming(false);
    setSuccess(false);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = Object.fromEntries(changed.map(({ key }) => [key, next[key]]));
      const res = await authFetch(`${API_URL}/api/system/retention`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.error || `Failed: ${res.status}`);
      }
      apply((await res.json()) as Retention);
      setConfirming(false);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (readOnly) return;
    if (shortened.length > 0) setConfirming(true);
    else void save();
  };

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-4">
      <div>
        <Header />
        <p className="text-xs text-[#6B7785]">
          How long Aeolus keeps a record of automation runs and device commands. Older entries are removed automatically.
          Installations that need a longer audit trail can raise either period or keep it forever.
        </p>
        {readOnly && (
          <p className="text-xs text-[#72B7E6] mt-1">Public demo: change the fields to explore the setting. Nothing here can be saved.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {HISTORIES.map(({ key, label, description }) => {
          const draft = drafts[key];
          const invalid = next[key] === undefined;
          return (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`retention-${key}`} className="text-[10px] text-[#6B7785] uppercase tracking-wider block">
                {label}
              </label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <input
                    id={`retention-${key}`}
                    type="number"
                    min={MIN_RETENTION_DAYS}
                    max={MAX_RETENTION_DAYS}
                    step={1}
                    value={draft.days}
                    disabled={draft.forever}
                    aria-invalid={invalid}
                    onChange={(e) => edit(key, { days: e.target.value })}
                    className={`w-24 text-sm bg-background border rounded-lg px-3 py-1.5 text-[#E6EDF3] font-mono focus:outline-none focus:border-primary disabled:opacity-40 ${
                      invalid ? "border-[#EF4444]" : "border-[#2A3441]"
                    }`}
                  />
                  <span className="text-xs text-[#6B7785]">days</span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-[#9AA6B2] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.forever}
                    onChange={(e) =>
                      edit(key, { forever: e.target.checked, days: e.target.checked ? draft.days : draft.days || String(saved[key] ?? 7) })
                    }
                    className="accent-primary"
                  />
                  Keep forever
                </label>
              </div>
              <p className="text-[10px] text-[#6B7785]">{description}</p>
              {invalid && (
                <p className="text-[10px] text-[#EF4444]">
                  Enter a whole number of days from {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS}.
                </p>
              )}
              {draft.forever && <p className="text-[10px] text-[#F59E0B]">Kept forever, this history grows without limit.</p>}
            </div>
          );
        })}
      </div>

      {confirming && (
        <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-xs text-[#E6EDF3]">
              Saving deletes {shortened.map(({ label, key }) => `${label.toLowerCase()} older than ${period(next[key] as number)}`).join(" and ")}{" "}
              straight away. This cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Delete older history and save
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[#9AA6B2] hover:text-[#E6EDF3] border border-[#2A3441] rounded-lg px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-[#EF4444]">{error}</p>}

      {!confirming && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={readOnly || saving || !valid || changed.length === 0}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            {readOnly ? "Demo preview · not saved" : "Save"}
          </button>
          {success && <span className="text-xs text-[#22C55E]">Saved and applied</span>}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2 mb-2">
      <History size={14} className="text-primary" />
      <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">History retention</span>
    </div>
  );
}
