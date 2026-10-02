export function AutomationDraftBanner({ savedAt, conflict, onRestore, onDiscard }: {
  savedAt: number; conflict: boolean; onRestore: () => void; onDiscard: () => void;
}) {
  return <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-[#E6EDF3] space-y-2">
    <p>Unsaved local automation draft from {new Date(savedAt).toLocaleString()}.</p>
    {conflict && <p className="text-amber-300">The server version changed since this draft began. Restoring only edits this browser; saving must pass a fresh server-version check.</p>}
    <div className="flex gap-3">
      <button type="button" className="text-[#5CE1E6] underline" onClick={onRestore}>Restore local draft</button>
      <button type="button" className="text-[#9AA6B2] underline" onClick={onDiscard}>Discard local draft</button>
    </div>
  </div>;
}
