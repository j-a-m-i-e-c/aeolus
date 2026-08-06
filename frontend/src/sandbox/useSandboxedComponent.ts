// frontend/src/sandbox/useSandboxedComponent.ts — Host-side hook that owns a sandbox frame
//
// Creates an opaque-origin sandboxed iframe, completes the handshake, transfers a
// dedicated MessagePort, registers it with the shared broker, and posts the inert
// compiled module source + initial props. Manages the frame's lifecycle against a
// bounded pool and tears everything down on unmount (Requirements 2.x, 7.3, 7.4).

import { useEffect, useRef, useState, useCallback } from "react";
import { authFetch } from "../lib/auth-fetch";
import { API_URL } from "../lib/env";
import { sandboxBroker } from "./sandbox-host";
import { sandboxPool } from "./sandbox-pool";
import {
  RPC_CHANNEL,
  isRpcHandshake,
  isRpcFatal,
  type EntityType,
  type PropsPayload,
  type RpcInit,
  type RpcAck,
} from "./rpc-types";

/** The static sandbox document served by nginx from the public dir. */
const SANDBOX_DOCUMENT = "/sandbox.html";

/** How long to wait for the frame's handshake before failing (ms). */
const HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Operating posture. In v1 BOTH modes produce the identical `allow-scripts`-only
 * frame and enforce the same broker allowlist — trusted mode does NOT relax
 * isolation (Requirements 8.2, 8.3, 9.1). The flag is threaded so the documented
 * trusted-administrator fallback (Requirement 9.2) can be activated only via the
 * documentation correction, never by weakening the runtime here.
 */
export type SandboxMode = "trusted" | "untrusted";

export type SandboxStatus = "idle" | "loading" | "ready" | "error";

export interface UseSandboxedComponentResult {
  status: SandboxStatus;
  error: string | null;
  /** Attach to the container element the iframe is mounted into. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Push a partial props update into the frame (devices/history/enabled/…). */
  sendPropsPatch: (patch: Partial<PropsPayload>) => void;
}

let frameCounter = 0;
function nextFrameId(entityId: string): string {
  frameCounter += 1;
  return `frame-${entityId}-${frameCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build the sandbox iframe with the minimal capability set (allow-scripts only). */
function createSandboxIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  // ONLY allow-scripts — deliberately NO allow-same-origin (opaque origin), and no
  // allow-top-navigation / allow-popups (Requirements 2.2, 2.3, 2.4).
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("src", SANDBOX_DOCUMENT);
  iframe.setAttribute("title", "Custom UI sandbox");
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  return iframe;
}

export function useSandboxedComponent(
  entityType: EntityType,
  entityId: string,
  hasUiSource: boolean,
  props: PropsPayload,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- threaded for Req 8/9; must NOT alter v1 isolation
  mode: SandboxMode = "untrusted",
  readOnly = false,
): UseSandboxedComponentResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<SandboxStatus>(hasUiSource ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);

  // Kept current so the grant reflects the live permission at frame creation
  // without forcing a frame rebuild when it changes (it is static per session).
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // Live frame id for prop-patch forwarding; null when no frame is active.
  const frameIdRef = useRef<string | null>(null);
  // Keep the latest props in a ref so the init payload is always current.
  const propsRef = useRef<PropsPayload>(props);
  propsRef.current = props;

  useEffect(() => {
    if (!hasUiSource || !entityId) {
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    const frameId = nextFrameId(entityId);
    let iframe: HTMLIFrameElement | null = null;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

    setStatus("loading");
    setError(null);

    /** Window-level listener: handshake (carries no port yet) + fatal errors. */
    const onWindowMessage = (event: MessageEvent) => {
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;

      if (isRpcHandshake(data)) {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        completeHandshake();
        return;
      }

      if (isRpcFatal(data)) {
        fail(data.message);
      }
    };

    /** After the frame says it's ready: transfer a port, register, and init. */
    const completeHandshake = () => {
      if (cancelled || !iframe) return;

      const channel = new MessageChannel();
      const hostPort = channel.port1;
      const framePort = channel.port2;

      // Register the host side with the shared broker (immutable grant).
      sandboxBroker.register({ frameId, entityType, entityId, port: hostPort, readOnly: readOnlyRef.current });

      // Hand the frame its dedicated port via an ack (opaque origin → targetOrigin "*").
      const ack: RpcAck = { channel: RPC_CHANNEL, kind: "ack" };
      iframe.contentWindow?.postMessage(ack, "*", [framePort]);

      // Post the inert module source + initial props over the host port.
      const init: RpcInit = {
        channel: RPC_CHANNEL,
        kind: "init",
        entityType,
        moduleSource: moduleSourceRef.current,
        props: propsRef.current,
      };
      hostPort.postMessage(init);

      // Track in the pool; eviction tears this frame down (Req 7.3).
      sandboxPool.acquire(frameId, teardown);
      frameIdRef.current = frameId;

      if (!cancelled) setStatus("ready");
    };

    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      setStatus("error");
      teardown();
    };

    const teardown = () => {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
      window.removeEventListener("message", onWindowMessage);
      sandboxBroker.unregister(frameId);
      sandboxPool.release(frameId);
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      iframe = null;
      if (frameIdRef.current === frameId) frameIdRef.current = null;
    };

    const moduleSourceRef = { current: "" };

    // Fetch the compiled module (host holds the token; only text crosses into the frame).
    const moduleUrl =
      entityType === "automation"
        ? `${API_URL}/api/automations/${entityId}/ui-module`
        : `${API_URL}/api/panels/${entityId}/ui-module`;

    (async () => {
      try {
        const response = await authFetch(moduleUrl);
        if (cancelled) return;
        if (!response.ok) {
          fail(`Failed to load UI module (${response.status})`);
          return;
        }
        moduleSourceRef.current = await response.text();
        if (cancelled) return;

        // Mount the iframe and begin listening for its handshake.
        window.addEventListener("message", onWindowMessage);
        iframe = createSandboxIframe();
        const container = containerRef.current;
        if (!container) {
          fail("Sandbox container not mounted");
          return;
        }
        container.appendChild(iframe);

        handshakeTimer = setTimeout(() => {
          fail("Sandbox failed to initialize (handshake timeout)");
        }, HANDSHAKE_TIMEOUT_MS);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof TypeError
            ? "Connection error — could not reach the server"
            : err instanceof Error
              ? err.message
              : "Failed to load UI module";
        fail(message);
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
    // Re-create the frame when the target entity or its UI presence changes, or
    // when the read-only grant flips (e.g. permissions resolve after first
    // render) so the broker grant reflects the correct capability. Live prop
    // updates flow through sendPropsPatch, not a frame rebuild.
  }, [entityType, entityId, hasUiSource, readOnly]);

  const sendPropsPatch = useCallback((patch: Partial<PropsPayload>) => {
    const frameId = frameIdRef.current;
    if (!frameId) return;
    sandboxBroker.emitProps(frameId, patch as Record<string, unknown>);
    sandboxPool.touch(frameId);
  }, []);

  return { status, error, containerRef, sendPropsPatch };
}
