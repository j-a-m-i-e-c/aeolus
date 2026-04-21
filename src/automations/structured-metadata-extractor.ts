// src/automations/structured-metadata-extractor.ts — Best-effort extraction of automation() call metadata

/** Structured metadata extracted from an automation() call in transpiled JS. */
export interface StructuredMetadata {
  trigger: string;
  conditions: string[];
  actions: string[];
}

/**
 * Find the matching closing brace for a function body that starts at `startIndex`.
 * `startIndex` should point to the opening `{` of the function body.
 * Returns the index of the matching `}`, or -1 if not found.
 */
function findMatchingBrace(source: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Find the matching closing bracket for an array that starts at `startIndex`.
 * `startIndex` should point to the opening `[`.
 * Returns the index of the matching `]`, or -1 if not found.
 */
function findMatchingBracket(source: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "[") {
      depth++;
    } else if (source[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extract the function body text between the outermost braces,
 * trimming leading/trailing whitespace from the result.
 */
function extractFunctionBody(source: string, searchStart: number): { body: string; end: number } | null {
  const braceIndex = source.indexOf("{", searchStart);
  if (braceIndex === -1) return null;

  const closeIndex = findMatchingBrace(source, braceIndex);
  if (closeIndex === -1) return null;

  const body = source.slice(braceIndex + 1, closeIndex).trim();
  return { body, end: closeIndex };
}

/**
 * Extract named function names from an array body (the text between `[` and `]`).
 * Looks for `function <name>(` patterns. Falls back to extracting function body text
 * for anonymous/arrow functions.
 */
function extractNamesFromArray(arrayBody: string): string[] {
  const names: string[] = [];
  const namedFnRe = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = namedFnRe.exec(arrayBody)) !== null) {
    names.push(m[1]);
  }
  if (names.length > 0) return names;

  // Fallback: extract function bodies for anonymous functions
  const fnRe = /(?:function\s*\([^)]*\)|(?:async\s+)?\([^)]*\)\s*=>|\([^)]*\)\s*=>)\s*\{/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRe.exec(arrayBody)) !== null) {
    const bodyStart = arrayBody.indexOf("{", fnMatch.index + fnMatch[0].length - 1);
    const result = extractFunctionBody(arrayBody, bodyStart);
    if (result) {
      names.push(result.body);
    }
  }
  return names;
}

/**
 * Extract items from a single (non-array) function value.
 * Looks for `function <name>(` first, then falls back to body text.
 */
function extractNamesFromSingleFn(fnSource: string): string[] {
  const namedFnRe = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/;
  const m = namedFnRe.exec(fnSource);
  if (m) return [m[1]];

  // Fallback: extract the function body
  const fnRe = /(?:function\s*\([^)]*\)|(?:async\s+)?\([^)]*\)\s*=>|\([^)]*\)\s*=>)\s*\{/;
  const fnMatch = fnRe.exec(fnSource);
  if (fnMatch) {
    const bodyStart = fnSource.indexOf("{", fnMatch.index + fnMatch[0].length - 1);
    const result = extractFunctionBody(fnSource, bodyStart);
    if (result) return [result.body];
  }
  return [];
}

/**
 * Extract items for a given property key (e.g. "conditions" or "actions") from the config body.
 * Handles both array form `key: [...]` and single function form `key: (ctx) => { ... }`.
 * Also handles the legacy singular "condition" key.
 */
function extractPropertyItems(configBody: string, keys: string[]): string[] {
  for (const key of keys) {
    const keyRe = new RegExp(`\\b${key}\\s*:\\s*`);
    const keyMatch = keyRe.exec(configBody);
    if (!keyMatch) continue;

    const afterKey = keyMatch.index + keyMatch[0].length;
    const firstChar = configBody.charAt(afterKey);

    if (firstChar === "[") {
      // Array form
      const closeIndex = findMatchingBracket(configBody, afterKey);
      if (closeIndex === -1) continue;
      const arrayBody = configBody.slice(afterKey + 1, closeIndex);
      return extractNamesFromArray(arrayBody);
    } else {
      // Single function form — extract up to the next top-level comma or end of config
      // Find the function body to determine its extent
      const fnSource = configBody.slice(afterKey);
      return extractNamesFromSingleFn(fnSource);
    }
  }
  return [];
}

/**
 * Best-effort extraction of `automation()` call metadata from transpiled JavaScript.
 *
 * Supports both the new array format:
 * ```
 * automation({ conditions: [function a(ctx) { ... }], actions: [function b(ctx) { ... }] });
 * ```
 * and the legacy single-function format:
 * ```
 * automation({ condition: (ctx) => { ... }, actions: (ctx) => { ... } });
 * ```
 *
 * @param compiledJs - The transpiled JavaScript source.
 * @param triggerTopic - The trigger topic from the rule (not from the code).
 * @returns The extracted metadata, or `null` if the pattern doesn't match.
 */
export function extractStructuredMetadata(
  compiledJs: string,
  triggerTopic: string,
): StructuredMetadata | null {
  // Look for the automation( call — must appear as a top-level call
  const automationCallRe = /\bautomation\s*\(\s*\{/;
  const match = automationCallRe.exec(compiledJs);
  if (!match) return null;

  const configStart = match.index + match[0].length - 1; // points to the `{`

  // Find the end of the config object by brace-matching
  const configClose = findMatchingBrace(compiledJs, configStart);
  if (configClose === -1) return null;

  const configBody = compiledJs.slice(configStart, configClose + 1);

  // Extract actions — required (try plural first, then singular)
  const actions = extractPropertyItems(configBody, ["actions"]);
  if (actions.length === 0) return null;

  // Extract conditions — optional (try plural first, then legacy singular)
  const conditions = extractPropertyItems(configBody, ["conditions", "condition"]);

  return {
    trigger: triggerTopic,
    conditions,
    actions,
  };
}
