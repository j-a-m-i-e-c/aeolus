// frontend/src/lib/topic-filter.ts — MQTT topic-filter matching (mirrors backend semantics)

/**
 * Test whether a concrete MQTT topic matches an MQTT topic filter (`+` matches a
 * single level, `#` matches the remaining levels). Empty inputs match nothing.
 * Kept in sync with `src/mqtt/topic-filter.ts` on the backend; used only for
 * display hints (marking which messages are hidden from non-admins).
 */
export function matchesTopicFilter(filter: string, topic: string): boolean {
  if (!filter || !topic) return false;
  if (filter === topic) return true;

  const filterParts = filter.split("/");
  const topicParts = topic.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    const part = filterParts[i];
    if (part === "#") return true;
    if (part === "+") {
      if (i >= topicParts.length) return false;
      continue;
    }
    if (i >= topicParts.length || part !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}

/** True iff `topic` matches any of the given filters. */
export function matchesAnyFilter(filters: string[], topic: string): boolean {
  return filters.some((f) => matchesTopicFilter(f, topic));
}

/**
 * Validate that `filter` is a well-formed MQTT topic filter. Mirrors
 * `src/mqtt/topic-filter.ts` on the backend. Rules:
 *  - non-empty, at most 65535 chars, no null character;
 *  - `#` (multi-level) must be a whole level and the last one;
 *  - `+` (single-level) must occupy a whole level on its own.
 */
export function isValidTopicFilter(filter: string): boolean {
  if (!filter || filter.length > 65535 || filter.includes("\u0000")) return false;

  const levels = filter.split("/");
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.includes("#")) {
      if (level !== "#" || i !== levels.length - 1) return false;
    } else if (level.includes("+")) {
      if (level !== "+") return false;
    }
  }
  return true;
}
