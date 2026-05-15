// src/automations/transpiler.ts — TypeScript/TSX → JavaScript transpilation via esbuild

import { transformSync, type Message } from "esbuild";

/** Structured error from transpilation with source location. */
export interface TranspileError {
  line: number;
  column: number;
  message: string;
}

/** Result of transpiling TypeScript source to JavaScript. */
export type TranspileResult =
  | { success: true; js: string }
  | { success: false; errors: TranspileError[] };

/**
 * Regex that catches import/require patterns that must be rejected:
 * - `import ... from '...'`
 * - `import '...'` (side-effect import)
 * - `import(...)` (dynamic import)
 * - `require(...)`
 * - `export ... from '...'`
 */
const IMPORT_REQUIRE_RE =
  /\b(?:import\s+[\s\S]*?\s+from\s|import\s*\(|import\s+['"]|require\s*\(|export\s+[\s\S]*?\s+from\s)/;

/** Map esbuild error messages to our TranspileError interface. */
function mapEsbuildErrors(messages: Message[]): TranspileError[] {
  return messages.map((msg) => ({
    line: msg.location?.line ?? 1,
    column: msg.location?.column ?? 0,
    message: msg.text,
  }));
}

/**
 * Transpile TSX source to ES module JavaScript for custom UI components.
 * Unlike transpile(), this allows import statements (for React/JSX runtime)
 * and configures the JSX transform to emit react-jsx runtime calls.
 */
export function transpileUi(source: string): TranspileResult {
  if (source.trim() === "") {
    return {
      success: false,
      errors: [{ line: 1, column: 0, message: "UI source cannot be empty" }],
    };
  }

  try {
    const result = transformSync(source, {
      loader: "tsx",
      target: "es2022",
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "react",
      sourcemap: false,
    });
    return { success: true, js: result.code };
  } catch (err: unknown) {
    const esbuildErr = err as { errors?: Message[] };
    if (esbuildErr.errors?.length) {
      return { success: false, errors: mapEsbuildErrors(esbuildErr.errors) };
    }
    return { success: false, errors: [{ line: 1, column: 0, message: String(err) }] };
  }
}

/**
 * Transpile TypeScript source to ES2022 JavaScript.
 *
 * - Strips type annotations via esbuild (fast, native)
 * - Rejects empty source strings
 * - Rejects source containing `import`/`require` statements before transpilation
 * - Returns structured errors with line/column on syntax failures
 */
export function transpile(source: string): TranspileResult {
  if (source.trim() === "") {
    return {
      success: false,
      errors: [{ line: 1, column: 0, message: "Script source cannot be empty" }],
    };
  }

  if (IMPORT_REQUIRE_RE.test(source)) {
    return {
      success: false,
      errors: [
        {
          line: 1,
          column: 0,
          message:
            "Import and require statements are not allowed in automation scripts. All APIs (devices, mqtt, log, context) are available as globals.",
        },
      ],
    };
  }

  try {
    const result = transformSync(source, {
      loader: "ts",
      target: "es2022",
      format: "esm",
      sourcemap: false,
    });
    return { success: true, js: result.code };
  } catch (err: unknown) {
    const esbuildErr = err as { errors?: Message[] };
    if (esbuildErr.errors?.length) {
      return { success: false, errors: mapEsbuildErrors(esbuildErr.errors) };
    }
    return { success: false, errors: [{ line: 1, column: 0, message: String(err) }] };
  }
}
