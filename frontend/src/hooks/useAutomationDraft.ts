import { useCallback, useEffect, useRef, useState } from "react";
import {
  readAutomationDraft, putAutomationDraft, deleteAutomationDraft,
  type DraftSnapshot,
} from "../lib/automation-drafts";

/**
 * A draft is ALWAYS opt-in on recovery: an old local copy must never silently
 * overwrite a newer server project. The caller must enable this hook only after
 * initial server source (if any) has loaded.
 */
export function useAutomationDraft<T>({ key, enabled, payload, restore }: {
  key: string;
  enabled: boolean;
  payload: T;
  restore: (payload: T) => void;
}) {
  const serialized = JSON.stringify(payload);
  const baseline = useRef<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [recovery, setRecovery] = useState<DraftSnapshot<T> | null>(null);
  const [serverBaseline, setServerBaseline] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const generation = useRef(0);
  const latestPayload = useRef(serialized);
  const latestPayloadObject = useRef(payload);
  latestPayload.current = serialized;
  latestPayloadObject.current = payload;

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    if (pending.current) clearTimeout(pending.current);
    baseline.current = null;
    setServerBaseline(null);
    setReady(false);
    setRecovery(null);
    setSavedAt(null);
    if (!enabled || !key) return;
    const initial = serialized;
    baseline.current = initial;
    setServerBaseline(initial);
    void readAutomationDraft<T>(key).then((stored) => {
      if (generation.current !== current) return;
      // Only actual unsaved work is recoverable. Never auto-apply it.
      if (stored && JSON.stringify(stored.payload) !== initial) {
        setRecovery(stored);
        setSavedAt(stored.savedAt);
      }
      setReady(true);
    }).catch(() => {
      if (generation.current !== current) return;
      setStorageError(true);
      setReady(true);
    });
    return () => { if (pending.current) clearTimeout(pending.current); };
    // `serialized` deliberately excluded: the baseline is established once
    // per loaded server version, not on each edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !key || !ready || baseline.current === null || serialized === baseline.current) return;
    // While the recovery prompt is visible, don't destroy the recoverable
    // snapshot with a new automatic save before the author has chosen.
    if (recovery) return;
    if (pending.current) clearTimeout(pending.current);
    const at = Date.now();
    const draft: DraftSnapshot<T> = { key, baseline: baseline.current, payload, savedAt: at };
    const current = generation.current;
    pending.current = setTimeout(() => {
      pending.current = null;
      void putAutomationDraft(draft).then(() => {
        if (generation.current === current) setSavedAt(at);
      }).catch(() => setStorageError(true));
    }, 500);
    return () => { if (pending.current) clearTimeout(pending.current); };
  // `serialized` tracks actual changes; including the freshly-created `payload`
  // object would reschedule the same write on every status render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, ready, serialized, recovery]);

  const recover = useCallback(() => {
    if (!recovery) return;
    restore(recovery.payload);
    setRecovery(null);
  }, [recovery, restore]);
  const discardRecovery = useCallback(() => {
    setRecovery(null);
    void deleteAutomationDraft(key).catch(() => setStorageError(true));
  }, [key]);
  const markSaved = useCallback((savedPayload: T): T | null => {
    if (pending.current) clearTimeout(pending.current);
    // If the user kept typing while the network request was in flight, retain
    // the newer local changes rather than clearing their recovery draft.
    if (JSON.stringify(savedPayload) === latestPayload.current) {
      baseline.current = latestPayload.current;
      setServerBaseline(latestPayload.current);
      setRecovery(null);
      setSavedAt(null);
      void deleteAutomationDraft(key).catch(() => setStorageError(true));
      return null;
    }
    // A server acknowledgement only confirms the submitted snapshot. Preserve
    // changes typed while the request was in flight immediately, not after
    // another debounce (the editor could close or change identity now).
    const newer = latestPayloadObject.current;
    void putAutomationDraft({ key, baseline: JSON.stringify(savedPayload), payload: newer, savedAt: Date.now() })
      .catch(() => setStorageError(true));
    return newer;
  }, [key]);

  return { recovery, recover, discardRecovery, markSaved, savedAt, storageError, serverBaseline };
}
