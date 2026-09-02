// frontend/src/sandbox/runtime/entry.ts — Sandbox runtime bootstrap (runs INSIDE the frame)
//
// This is the entry point of the `sandbox-runtime` bundle loaded by
// `public/sandbox.html` into the opaque-origin iframe. It:
//   1. Exposes the bundled React on the frame-local `__SANDBOX_EXTERNALS__` global
//      so the author's compiled module resolves its react imports in-frame.
//   2. Posts a single `handshake` to window.parent (carries nothing sensitive).
//   3. Receives the host's `ack` whose transferred MessagePort becomes the sole
//      RPC channel; ignores all further `window` messages.
//   4. Receives the `init` message (over the port) with the inert module source
//      and initial props, loads + evaluates the module IN THIS REALM, and renders
//      it through the compatibility shim.
//
// The auth token never enters the frame; only inert text does.

import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
// Global stylesheet (Tailwind base/components/utilities). The custom UI author's
// component uses the same Tailwind utility classes the host app compiles. Because
// the frame is an isolated opaque-origin document, it does NOT inherit the host
// page's CSS — we must bundle the same stylesheet here so authored styling renders
// (Req 5.4). Vite emits it as a hashed asset and injects the <link> into the built
// sandbox.html; in dev it is served over the module graph. sandbox.html re-asserts
// a transparent background so this stylesheet's `body` background does not paint an
// opaque rectangle over the host pane.
import "../../index.css";
import * as aeolusUi from "../ui-kit";
import { SANDBOX_EXTERNALS_GLOBAL, loadModule } from "./module-loader";
import { createSdkClient } from "./sdk-client";
import { ShimHost } from "./shim";
import {
  RPC_CHANNEL,
  isRpcHandshake,
  type RpcInit,
  type RpcFatal,
  type RpcHandshake,
} from "../rpc-types";

// ─── Step 1: expose bundled React on the frame-local global ─────────────────

declare global {
  var __SANDBOX_EXTERNALS__: Record<string, unknown> | undefined;
}

// `@aeolus/ui` is the platform design-token and formatting module. Unlike React it
// is Aeolus' own code, and it is deliberately inert: pure functions, constants and
// style objects with no I/O and no reference to the SDK or the host page. Exposing
// it here gives authored UIs the theme they cannot otherwise reach (Tailwind classes
// authored outside frontend/src are purged) without granting any new capability.
(globalThis as Record<string, unknown>)[SANDBOX_EXTERNALS_GLOBAL] = {
  "react": React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "@aeolus/ui": aeolusUi,
};

// ─── Fatal error reporting (frame → host via window.parent) ─────────────────

function reportFatal(message: string): void {
  const fatal: RpcFatal = { channel: RPC_CHANNEL, kind: "fatal", message };
  try {
    window.parent.postMessage(fatal, "*");
  } catch {
    // Nothing more we can do from inside the sandbox.
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let port: MessagePort | null = null;

/** Handle the one-time init message delivered over the dedicated port. */
async function handleInit(init: RpcInit): Promise<void> {
  const rootElement = document.getElementById("sandbox-root");
  if (!rootElement) {
    reportFatal("Sandbox root element missing");
    return;
  }

  try {
    const Component = await loadModule(init.moduleSource);
    const sdk = createSdkClient(port!, init.props);
    const root = createRoot(rootElement);
    root.render(React.createElement(ShimHost, { sdk, entityType: init.entityType, Component }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load custom UI module";
    reportFatal(message);
  }
}

/** Receive the transferred MessagePort from the host `ack`, then wait for init. */
function handleAck(event: MessageEvent): void {
  const [received] = event.ports;
  if (!received) return;
  port = received;

  port.onmessage = (portEvent: MessageEvent) => {
    const message = portEvent.data as { channel?: string; kind?: string } | undefined;
    if (!message || message.channel !== RPC_CHANNEL) return;
    if (message.kind === "init") {
      void handleInit(portEvent.data as RpcInit);
    }
    // Any other message before the SDK client takes over the port is ignored.
    // Once handleInit runs, createSdkClient reassigns port.onmessage.
  };

  // The port is live; stop listening to window-level messages entirely.
  window.removeEventListener("message", onWindowMessage);
}

/** Window-level listener: only the host `ack` (carrying the port) is honored. */
function onWindowMessage(event: MessageEvent): void {
  const message = event.data as { channel?: string; kind?: string } | undefined;
  if (!message || message.channel !== RPC_CHANNEL) return;
  if (message.kind === "ack") {
    handleAck(event);
  }
}

window.addEventListener("message", onWindowMessage);

// Step 2: announce readiness to the host.
const handshake: RpcHandshake = { channel: RPC_CHANNEL, kind: "handshake" };
// The `isRpcHandshake` guard is exercised host-side; referenced here to keep the
// contract import meaningful and to validate our own outgoing message shape.
if (isRpcHandshake(handshake)) {
  window.parent.postMessage(handshake, "*");
}
