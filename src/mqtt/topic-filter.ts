// src/mqtt/topic-filter.ts — MQTT topic-filter matching (single-level `+`, multi-level `#`)

/**
 * Test whether a concrete MQTT topic matches an MQTT topic filter using the
 * standard wildcards:
 *
 *  - `+` matches exactly one topic level.
 *  - `#` matches the remaining levels (must be the last segment); `sport/#`
 *    matches `sport`, `sport/tennis`, and `sport/tennis/player1`.
 *
 * An empty filter or empty topic matches nothing (fail-closed for callers that
 * use this to decide visibility). Matching is case-sensitive, consistent with
 * MQTT and with how the device registry derives ids from topics.
 */
export function matchesTopicFilter(filter: string, topic: string): boolean {
  if (!filter || !topic) return false;
  if (filter === topic) return true;

  const filterParts = filter.split("/");
  const topicParts = topic.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    const part = filterParts[i];

    // `#` matches this level and every level after it. Per MQTT, `sport/#` also
    // matches the parent `sport`, which the length check below already allows
    // because `#` is reached only after the shared prefix matched.
    if (part === "#") return true;

    // `+` matches any single existing level.
    if (part === "+") {
      if (i >= topicParts.length) return false;
      continue;
    }

    // Literal level must be present and identical.
    if (i >= topicParts.length || part !== topicParts[i]) return false;
  }

  // No wildcard consumed the tail: both must have the same number of levels.
  return filterParts.length === topicParts.length;
}

/**
 * Validate that `filter` is a well-formed MQTT topic filter. Rules follow the
 * MQTT spec for the reserved wildcard characters:
 *
 *  - the filter is non-empty, at most 65535 characters, and contains no null
 *    character (U+0000);
 *  - the multi-level wildcard `#`, when present, must occupy an entire level on
 *    its own AND be the final level (so `sport/#` is valid; `sport/#/x` and
 *    `sport#` are not);
 *  - the single-level wildcard `+` must occupy an entire level on its own (so
 *    `sport/+/x` is valid; `sport+` is not).
 *
 * Empty levels (e.g. `a//b`, leading/trailing `/`) are permitted, matching the
 * MQTT spec. Use this to reject malformed filters before storing them.
 */
export function isValidTopicFilter(filter: string): boolean {
  if (!filter || filter.length > 65535 || filter.includes("\u0000")) return false;

  const levels = filter.split("/");
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.includes("#")) {
      // `#` must be the whole level and the last level.
      if (level !== "#" || i !== levels.length - 1) return false;
    } else if (level.includes("+")) {
      // `+` must occupy the whole level.
      if (level !== "+") return false;
    }
  }
  return true;
}
