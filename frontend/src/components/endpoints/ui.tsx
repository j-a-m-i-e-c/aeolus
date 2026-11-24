// frontend/src/components/endpoints/ui.tsx — small presentational pieces shared by the
// Endpoints section: section frames, buttons, status pills, copy and confirmation.

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { StatusTone } from "./endpoint-format";

export function Section({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border-b border-[#202A36] px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-xs font-semibold text-[#E6EDF3]">{title}</h3>
          {hint && <div className="mt-0.5 text-[10px] leading-relaxed text-[#7E8A98]">{hint}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

type ButtonTone = "primary" | "quiet" | "danger";
const TONES: Record<ButtonTone, string> = {
  primary: "bg-[#5CE1E6]/15 text-[#DDFBFF] border-[#5CE1E6]/40 hover:bg-[#5CE1E6]/25",
  quiet: "bg-transparent text-[#9AA6B2] border-[#2A3441] hover:text-[#E6EDF3] hover:bg-[#171E28]",
  danger: "bg-[#EF4444]/10 text-[#FCA5A5] border-[#EF4444]/35 hover:bg-[#EF4444]/20",
};

export function Button({ tone = "quiet", children, className = "", ...props }: { tone?: ButtonTone } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

const PILL: Record<StatusTone, string> = {
  ok: "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#86EFAC]",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  off: "border-[#2A3441] bg-[#171E28] text-[#9AA6B2]",
  error: "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]",
};

/** A status label. The text carries the meaning; colour only reinforces it. */
export function Pill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${PILL[tone]}`}>{children}</span>;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await copyTextToClipboard(text);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };
  return (
    <Button onClick={copy} aria-label={label} title={label}>
      {copied === "yes" ? <Check size={11} className="text-[#86EFAC]" /> : <Copy size={11} />}
      {copied === "yes" ? "Copied" : copied === "failed" ? "Copy failed: select and copy by hand" : "Copy"}
    </Button>
  );
}

export function CodeBlock({ code, copyLabel }: { code: string; copyLabel: string }) {
  return (
    <div className="relative rounded-md border border-[#202A36] bg-[#0B0F14]">
      <pre className="overflow-x-auto p-3 pr-20 text-[10px] leading-relaxed text-[#B9C4CF]"><code>{code}</code></pre>
      <div className="absolute right-2 top-2"><CopyButton text={code} label={copyLabel} /></div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const style = {
    info: "border-[#3BA4FF]/30 bg-[#3BA4FF]/5 text-[#B9DCFF]",
    warn: "border-amber-500/30 bg-amber-500/5 text-amber-200",
    error: "border-[#EF4444]/35 bg-[#EF4444]/5 text-[#FCA5A5]",
    ok: "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#B7F7CC]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[10px] leading-relaxed ${style}`}>
      {(tone === "warn" || tone === "error") && <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<void>;
}

/** A modal confirmation. Destructive actions focus Cancel, so Enter never confirms by accident. */
export function ConfirmDialog({ request, busy, onConfirm, onCancel }: { request: ConfirmRequest; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (request.destructive ? cancelRef : confirmRef).current?.focus();
  }, [request]);
  return <Overlay>{(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md space-y-4 rounded-xl border border-[#2A3441] bg-[#10161F] p-5 shadow-xl">
        <h3 id={titleId} className="text-sm font-semibold text-[#E6EDF3]">{request.title}</h3>
        <div className="space-y-2 text-[11px] leading-relaxed text-[#B9C4CF]">{request.body}</div>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button ref={confirmRef} tone={request.destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )}</Overlay>;
}

/**
 * Renders a modal into document.body. Dashboard panes are positioned with CSS
 * transforms, which would otherwise make a `position: fixed` overlay fixed to the
 * pane instead of the window, clipping it.
 */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
