// src/automations/structured-metadata-extractor.ts — Best-effort extraction of automation() call metadata

/** Structured metadata extracted from an automation() call in transpiled JS. */
export interface StructuredMetadata {
  trigger: string;
  conditionText: string | null;
  actionsText: string;
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
 * Best-effort extraction of `automation()` call metadata from transpiled JavaScript.
 *
 * After transpilation, the `automation()` call looks like:
 * ```
 * automation({ condition: (ctx) => { ... }, actions: (ctx) => { ... } });
 * ```
 *
 * The function uses regex to locate the `automation(` call, then uses
 * brace-matching to extract the condition and actions function bodies.
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

  // Extract actions body — required
  const actionsRe = /\bactions\s*:\s*(?:function\s*\([^)]*\)|(?:async\s+)?\([^)]*\)\s*=>|\([^)]*\)\s*=>)\s*\{/;
  const actionsMatch = actionsRe.exec(configBody);
  if (!actionsMatch) return null;

  const actionsBodyStart = configBody.indexOf("{", actionsMatch.index + actionsMatch[0].length - 1);
  const actionsResult = extractFunctionBody(configBody, actionsBodyStart);
  if (!actionsResult) return null;

  // Extract condition body — optional
  let conditionText: string | null = null;
  const conditionRe = /\bcondition\s*:\s*(?:function\s*\([^)]*\)|(?:async\s+)?\([^)]*\)\s*=>|\([^)]*\)\s*=>)\s*\{/;
  const conditionMatch = conditionRe.exec(configBody);
  if (conditionMatch) {
    const conditionBodyStart = configBody.indexOf("{", conditionMatch.index + conditionMatch[0].length - 1);
    const conditionResult = extractFunctionBody(configBody, conditionBodyStart);
    if (conditionResult) {
      conditionText = conditionResult.body;
    }
  }

  return {
    trigger: triggerTopic,
    conditionText,
    actionsText: actionsResult.body,
  };
}
