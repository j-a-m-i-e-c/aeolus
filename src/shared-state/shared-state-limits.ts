// src/shared-state/shared-state-limits.ts — Bounds that keep Shared State small

/**
 * Maximum serialized size of one Shared State value, in bytes.
 *
 * Shared State is always available to authorised automations and is not governed
 * by the historical Data Store's `maxStorageMb`, so it needs its own ceiling or
 * it becomes an unbounded disk-writing escape hatch on a constrained edge device.
 *
 * 64 KiB matches the scale of an Automation Event payload, which is the right
 * comparison: both carry "one thing an automation wants to say", not a document.
 */
export const MAX_SHARED_STATE_VALUE_BYTES = 64 * 1024;

/**
 * Maximum length of a bucket or key name.
 *
 * Matches the bound the REST layer has always applied to bucket/key path
 * segments, so promoting Shared State does not quietly widen what is storable.
 */
export const MAX_SHARED_STATE_NAME_LENGTH = 200;

/**
 * Maximum number of Shared State entries across all buckets.
 *
 * Shared State is small current state — a few dozen keys per subsystem is the
 * shape it is designed for. This cap exists so a runaway loop writing
 * `shared.set(bucket, uuid(), …)` fails loudly instead of filling the disk.
 */
export const MAX_SHARED_STATE_ENTRIES = 5_000;

/**
 * Characters that may never appear in a bucket or key name.
 *
 * A Shared State value is addressed reactively as `<bucket>/<key>`, matched with
 * the same `+`/`#` pattern syntax as a trigger topic. Allowing those characters
 * inside a name would mean one stored value had several possible reactive paths,
 * or a name that silently behaved as a wildcard.
 */
const FORBIDDEN_NAME_CHARS = /[/+#]/;

/**
 * Names that are forbidden outright because they are path navigation rather than
 * identifiers. A dot *inside* a name is fine; a name that IS a dot is not.
 */
const FORBIDDEN_WHOLE_NAMES = new Set([".", ".."]);

/** Why a name or value was refused. `null` means it is acceptable. */
export type SharedStateRejection = string | null;

/**
 * Validate one bucket or key name for a NEW Shared State write.
 *
 * Reads are deliberately not validated: an install may already hold legacy
 * bucket names containing these characters, and those must stay readable. They
 * simply have no unambiguous reactive path, which is the honest answer rather
 * than pretending otherwise.
 */
export function validateSharedStateName(label: string, name: string): SharedStateRejection {
  if (typeof name !== "string" || name.length === 0) {
    return `${label} is required`;
  }
  if (name.length > MAX_SHARED_STATE_NAME_LENGTH) {
    return `${label} exceeds ${MAX_SHARED_STATE_NAME_LENGTH} characters`;
  }
  if (FORBIDDEN_NAME_CHARS.test(name)) {
    return `${label} may not contain '/', '+' or '#'`;
  }
  if (FORBIDDEN_WHOLE_NAMES.has(name)) {
    return `${label} may not be '.' or '..'`;
  }
  // Control characters would make a reactive path unprintable and unmatchable.
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    return `${label} may not contain control characters`;
  }
  return null;
}

/**
 * Validate a reactive Shared State trigger pattern.
 *
 * A stored value's canonical path is exactly `<bucket>/<key>` — two segments. A
 * pattern may match it exactly, or use the same `+` (one segment) and `#` (the
 * rest) wildcards as a trigger topic:
 *
 * ```text
 * bunker-summary/power   one value
 * bunker-summary/+       every key in one bucket
 * bunker-summary/#       every key in one bucket
 * +/power                the `power` key of every bucket
 * #                      every Shared State change
 * ```
 *
 * This is pattern syntax only. It does not imply MQTT transport — Shared State
 * changes never reach the broker.
 */
export function validateSharedStatePattern(pattern: string): SharedStateRejection {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    return "Shared State trigger pattern is required";
  }
  if (pattern !== pattern.trim()) {
    return "Shared State trigger pattern may not have leading or trailing whitespace";
  }

  const segments = pattern.split("/");

  // A path has two segments, so a pattern cannot usefully have more. `#` is the
  // one exception in spirit, but `a/b/#` still could never match a two-segment
  // path, so accepting it would just be a trap.
  if (segments.length > 2) {
    return "Shared State trigger pattern may have at most two segments (<bucket>/<key>)";
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.length === 0) {
      return "Shared State trigger pattern may not contain an empty segment";
    }
    if (segment === "#") {
      // `#` matches the remainder, so anything after it is unreachable.
      if (i !== segments.length - 1) {
        return "'#' may only appear as the final segment of a Shared State trigger pattern";
      }
      continue;
    }
    if (segment === "+") continue;
    // A literal segment is a name, and must obey the same rules a written name
    // does — otherwise a pattern could reference a path that can never exist.
    if (segment.includes("+") || segment.includes("#")) {
      return "'+' and '#' must be whole segments in a Shared State trigger pattern";
    }
    const rejection = validateSharedStateName(i === 0 ? "bucket" : "key", segment);
    if (rejection) return rejection;
  }

  return null;
}

/**
 * Validate a serialized Shared State value.
 *
 * `serialized` is the exact text that would be persisted, so the bound applies to
 * what actually reaches the disk rather than to an estimate of it.
 */
export function validateSharedStateValue(serialized: string): SharedStateRejection {
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_SHARED_STATE_VALUE_BYTES) {
    return `value exceeds the ${MAX_SHARED_STATE_VALUE_BYTES} byte Shared State limit (${bytes} bytes)`;
  }
  return null;
}
