// e2e/global-teardown.ts — fail the run if any artifact holds a Project API key.
//
// Runs after every spec, pass or fail, once traces, videos, screenshots and
// error-context files are on disk. It reports file names only, never the key.
// The HTML report is written after this hook, so CI scans playwright-report/ in a
// separate step before uploading it (.github/workflows/e2e.yml).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPaths } from "../scripts/e2e/credential-scan.mjs";

const OUTPUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-results");

export default async function globalTeardown(): Promise<void> {
  const { scanned, findings } = scanPaths([OUTPUT_DIR]);
  if (findings.length > 0) {
    throw new Error(
      `[e2e] credential scan failed: an API key was found in ${findings.length} place(s) under test-results/:\n` +
        findings.map((finding) => `  - ${finding}`).join("\n") +
        "\nDo not share these artifacts. Delete test-results/ and fix the leak.",
    );
  }
  process.stdout.write(`[e2e] credential scan passed: ${scanned} artifact file(s), no API key found\n`);
}
