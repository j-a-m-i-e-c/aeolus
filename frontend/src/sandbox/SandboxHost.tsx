// frontend/src/sandbox/SandboxHost.tsx — Host-side wrapper that renders a sandboxed frame
//
// Replaces the in-page `useDynamicComponent` + `<Component />` render path. It mounts
// the opaque-origin iframe (via useSandboxedComponent), forwards live props patches
// into the frame, shows an inline error on failure, and wraps everything in the
// existing CustomComponentBoundary so a host-side throw is still contained (Req 2.7).

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CustomComponentBoundary } from "../components/CustomComponentBoundary";
import { useSandboxedComponent, type SandboxMode } from "./useSandboxedComponent";
import type { EntityType, PropsPayload } from "./rpc-types";

export interface SandboxHostProps {
  entityType: EntityType;
  /** ruleId or panelId — the immutable grant for the frame. */
  entityId: string;
  hasUiSource: boolean;
  /** Full props payload assembled by the pane (devices, ids, history, state, …). */
  props: PropsPayload;
  /** v1: both modes are isolated identically; threaded for Req 8/9. */
  mode?: SandboxMode;
  className?: string;
}

export function SandboxHost({
  entityType,
  entityId,
  hasUiSource,
  props,
  mode = "untrusted",
  className,
}: SandboxHostProps) {
  const { status, error, containerRef, sendPropsPatch } = useSandboxedComponent(
    entityType,
    entityId,
    hasUiSource,
    props,
    mode,
  );

  const [hostFallback, setHostFallback] = useState(false);

  // Forward live props changes into the frame once it is ready. The pane recomputes
  // devices/history/lastFired/enabled/state; push them as a patch (Req 5.3).
  const lastSentRef = useRef<string>("");
  useEffect(() => {
    if (status !== "ready") return;
    const patch: Partial<PropsPayload> = {
      devices: props.devices,
      history: props.history,
      lastFired: props.lastFired,
      enabled: props.enabled,
      state: props.state,
    };
    // Avoid redundant postMessage churn: only send when the payload changed.
    const serialized = JSON.stringify(patch);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    sendPropsPatch(patch);
  }, [status, props.devices, props.history, props.lastFired, props.enabled, props.state, sendPropsPatch]);

  if (hostFallback) {
    return null;
  }

  return (
    <CustomComponentBoundary onFallback={() => setHostFallback(true)}>
      <div className={className ?? "relative h-full w-full"}>
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-[#6B7785]" />
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30">
            <AlertTriangle size={14} className="text-[#EF4444] shrink-0" />
            <span className="text-xs text-[#EF4444]">{error ?? "Failed to load custom UI"}</span>
          </div>
        )}

        {/* The iframe is mounted into this container by the hook. Kept in the tree
            across states so the ref is stable during the handshake. */}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ display: status === "error" ? "none" : "block" }}
        />
      </div>
    </CustomComponentBoundary>
  );
}
