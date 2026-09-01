// frontend/src/lib/env.ts — Centralized API and WebSocket base URLs.
//
// Single source of truth for the backend origin. Override at build time with
// VITE_API_URL / VITE_WS_URL; otherwise default to the current host on the
// backend's default port.

export const API_URL =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

export const WS_URL =
  import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001/ws`;

// Public demo mode. When true the frontend runs as the public demo: it
// auto-requests a demo session, shows a demo banner, and keeps shared mutations
// fail-closed while allowing safe local exploration of the real UI. Off unless VITE_PUBLIC_DEMO is exactly "true".
export const PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === "true";
