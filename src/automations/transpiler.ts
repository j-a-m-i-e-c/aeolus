// src/automations/transpiler.ts — TypeScript → JavaScript transpilation with import rejection

import ts from "typescript";

/** Structured error from transpilation with source location. */
export interface TranspileError {
  line: number;
  column: number;
  message: string;
}

/** Result of transpiling TypeScript source to JavaScript. */
export interface TranspileResult {
  success: true;
  js: string;
} | {
  success: false;
  errors: TranspileError[];
}

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

/**
 * Transpile TypeScript source to ES2022 JavaScript.
 *
 * - Strips type annotations via `ts.transpileModule()` (no full program creation)
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

  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: false,
      removeComments: false,
      sourceMap: false,
    },
    reportDiagnostics: true,
  });

  const diagnostics = result.diagnostics ?? [];

  if (diagnostics.length > 0) {
    const errors: TranspileError[] = diagnostics.map((d) => {
      let line = 1;
      let column = 0;
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        line = pos.line + 1;
        column = pos.character;
      }
      return {
        line,
        column,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      };
    });

    return { success: false, errors };
  }

  return { success: true, js: result.outputText };
}
