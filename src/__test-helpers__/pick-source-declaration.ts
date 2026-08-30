// src/__test-helpers__/pick-source-declaration.ts — lift one top-level
// declaration out of authored Automation Project source.
//
// Some showcase tests prove the SHIPPED helper maths rather than a copy of the
// algorithm, so they extract a helper from the authored source, transpile it and
// evaluate it. That only works if the extracted text is a complete declaration.
//
// These helpers used to be written one-per-line, so the tests matched a single
// line. Once the showcase projects were split into modules some declarations
// wrapped across lines (a parameter object type, a multi-line body), and a
// single-line match returned a truncated fragment that no longer parsed. This
// walks from the declaration keyword to its balanced end instead, so it does not
// care how the source is wrapped.

/** Characters that open and close a nesting level. */
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/**
 * Return the full source text of the top-level `name` declaration.
 *
 * Handles `function name(...) {...}`, `const name = ...;` and multi-declarator
 * statements such as `const A = 1, B = 2;` (the whole statement is returned, so
 * every name it declares comes along). Any leading `export ` is stripped, since
 * callers evaluate the result outside a module.
 *
 * @throws if `name` is not declared at the top level of `source`.
 */
export function pickDeclaration(source: string, name: string): string {
  const declaration = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?(function\\s*\\*?|const|let|var)\\s+${name}\\b`,
    "m",
  );
  const match = declaration.exec(source);
  if (!match) throw new Error(`declaration "${name}" not found in the authored source`);

  const isFunction = match[1].startsWith("function");
  // Start after `export ` so the extracted text is valid outside a module.
  const start = match.index + (match[0].startsWith("export") ? match[0].indexOf(match[1]) : 0);

  let depth = 0;
  let sawBody = false;
  let quote: string | null = null;
  let comment: "line" | "block" | null = null;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (comment === "line") {
      if (char === "\n") comment = null;
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") { comment = null; i++; }
      continue;
    }
    if (quote) {
      if (char === "\\") { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") { comment = "line"; i++; continue; }
    if (char === "/" && next === "*") { comment = "block"; i++; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }

    if (OPENERS.has(char)) {
      // Only a brace at nesting depth 0 opens the body. A `{` inside the
      // parameter list is an inline object type, not the start of the body.
      if (char === "{" && depth === 0) sawBody = true;
      depth++;
      continue;
    }
    if (CLOSERS.has(char)) {
      depth--;
      // A function declaration ends at the `}` that closes its body.
      if (isFunction && sawBody && depth === 0) return source.slice(start, i + 1);
      continue;
    }
    // A `const`/`let`/`var` statement ends at its top-level semicolon. The
    // showcase source always terminates these, so requiring the semicolon
    // avoids truncating a value that wraps across lines.
    if (!isFunction && depth === 0 && char === ";") {
      return source.slice(start, i + 1);
    }
  }

  throw new Error(`declaration "${name}" is not balanced in the authored source`);
}
