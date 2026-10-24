// frontend/src/lib/capture-mode.ts — presentation-only media capture mode.
//
// `?capture=1` enables a clean presentation view for screenshots/GIFs in the
// current browser tab. `?capture=0` disables it again. The query parameter is a
// one-shot control flag: after Aeolus consumes it, the flag is removed from the
// visible URL while the choice remains in sessionStorage for same-tab navigation.
//
// This flag must never grant capabilities or change backend behaviour. It only
// suppresses demo/presentation chrome and demo-only stimulus controls.

const STORAGE_KEY = "aeolus:capture-mode";

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
// resolved value through RpcInit.presentation instead.
export const CAPTURE_MODE = resolveBrowserCaptureMode();
