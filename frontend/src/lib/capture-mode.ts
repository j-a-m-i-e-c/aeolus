// frontend/src/lib/capture-mode.ts — presentation-only capture mode for the local showcase.
//
// For hand-recorded GIFs and video of the live showcase. `?capture=1` turns it on
// for the current browser tab and `?capture=0` turns it off. The query parameter is
// a one-shot control flag: after Aeolus consumes it, the flag is removed from the
// visible URL while the choice remains in sessionStorage for same-tab navigation.
//
// It hides exactly two things, and should stay that small:
//   1. dashboard arranging chrome (TabLayout, Sidebar tab editing), and
//   2. seeded DEMO SCENARIO stimulus controls inside project UIs, which carry
//      `data-aeolus-demo-scenario` and are hidden by a rule in index.css.
// Public-demo notices are deliberately NOT handled: the hosted demo is not a
// supported place to create media. Canonical still screenshots belong to a
// scripted capture, not to this mode.
//
// Only showcase builds (VITE_SHOWCASE) honour the flag; on a normal install it is
// ignored and left in the URL untouched. It must never grant capabilities or
// change backend behaviour.

const STORAGE_KEY = "aeolus:capture-mode";

// Showcase build: set by demo/compose/local-showcase.yml, and so also by the
// public-demo-local overlay that stacks on it. Read here rather than exported from
// lib/env.ts because this is its only consumer, and adding it there would break
// every test that mocks lib/env without it. Off unless VITE_SHOWCASE is exactly "true".
const SHOWCASE = import.meta.env.VITE_SHOWCASE === "true";

export interface CaptureModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parseExplicitCaptureMode(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function resolveCaptureMode(search: string, storage: CaptureModeStorage): boolean {
  const explicit = parseExplicitCaptureMode(new URLSearchParams(search).get("capture"));

  if (explicit === true) {
    storage.setItem(STORAGE_KEY, "1");
    return true;
  }

  if (explicit === false) {
    storage.removeItem(STORAGE_KEY);
    return false;
  }

  return storage.getItem(STORAGE_KEY) === "1";
}

export function removeCaptureParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("capture");
  const cleaned = params.toString();
  return cleaned ? `?${cleaned}` : "";
}

/**
 * Storage that never throws. Reading `window.sessionStorage` raises a
 * SecurityError when the browser blocks site storage, and `setItem` can raise
 * on quota. CAPTURE_MODE is evaluated while the app's modules are still
 * importing, so an exception here would blank the entire app rather than just
 * losing the capture preference. Degrading to "not remembered" is the right
 * failure: an explicit `?capture=1` still applies to the page it was given on.
 */
export function failSafeStorage(open: () => CaptureModeStorage): CaptureModeStorage {
  function attempt<T>(operation: (storage: CaptureModeStorage) => T, fallback: T): T {
    try {
      return operation(open());
    } catch {
      return fallback;
    }
  }
  return {
    getItem: (key) => attempt((storage) => storage.getItem(key), null),
    setItem: (key, value) => attempt((storage) => storage.setItem(key, value), undefined),
    removeItem: (key) => attempt((storage) => storage.removeItem(key), undefined),
  };
}

export function resolveBrowserCaptureMode(
  storage: CaptureModeStorage = failSafeStorage(() => window.sessionStorage),
): boolean {
  const { pathname, search, hash } = window.location;
  const hasCaptureParam = new URLSearchParams(search).has("capture");
  const enabled = resolveCaptureMode(search, storage);

  if (hasCaptureParam) {
    const cleanedSearch = removeCaptureParam(search);
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${cleanedSearch}${hash}`,
    );
  }

  return enabled;
}

// Unguarded `window`, like lib/env.ts: this module only ever runs in the browser
// app (and jsdom under test). The sandbox frame never imports it; it receives the
// resolved value through RpcInit.presentation instead. SHOWCASE is a build-time
// constant, so on a normal build the whole resolution is dead code.
export const CAPTURE_MODE = SHOWCASE && resolveBrowserCaptureMode();
