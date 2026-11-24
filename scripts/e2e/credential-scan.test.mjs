// scripts/e2e/credential-scan.test.mjs — the E2E artifact scanner and the masking contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_KEY_PATTERN, findKeys, readZip, scanPaths } from "./credential-scan.mjs";

const KEY = "aeo_0123456789abcdef_" + "A".repeat(20) + "-_" + "b".repeat(21);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A minimal ZIP (local headers + central directory), stored or deflated. */
function zip(files, { deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const body = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("the key pattern matches the issued format only", () => {
  assert.equal(KEY.length, 64);
  assert.ok(API_KEY_PATTERN.test(KEY));
  assert.ok(!API_KEY_PATTERN.test("aeo_0123456789abcdef_…bbbb"), "the masked form is not a key");
  assert.ok(!API_KEY_PATTERN.test("aeo_0123456789ABCDEF_" + "A".repeat(43)), "the key id is lower-case hex");
  assert.ok(!API_KEY_PATTERN.test("aeo_0123456789abcdef_" + "A".repeat(42)), "the secret is 43 characters");
});

test("finds a key in plain text, and reports nothing for clean text", () => {
  assert.deepEqual(findKeys(Buffer.from(`- textbox "API key": ${KEY}\n`), "error-context.md"), ["error-context.md"]);
  assert.deepEqual(findKeys(Buffer.from('Fill "[redacted]" getByLabel(\'API key\')'), "report"), []);
});

test("finds a key inside deflated and stored ZIP entries, including a nested archive", () => {
  const trace = zip({ "trace.trace": '{"type":"before"}\n', "resources/abc": `{"authorization":"Bearer ${KEY}"}` });
  assert.deepEqual(findKeys(trace, "trace.zip"), ["trace.zip > resources/abc"]);
  assert.deepEqual(findKeys(zip({ "inner.zip": trace }, { deflate: false }), "outer.zip"), ["outer.zip > inner.zip > resources/abc"]);
  assert.deepEqual(findKeys(zip({ "a.txt": "nothing here" }), "clean.zip"), []);
});

test("finds a key inside gzip and inside a base64-embedded ZIP, as in the HTML report", () => {
  assert.equal(findKeys(gzipSync(Buffer.from(KEY)), "body.gz").length, 1);
  const report = `<script>window.playwrightReportBase64 = "data:application/zip;base64,${zip({ "report.json": `{"title":"Fill \\"${KEY}\\""}` }).toString("base64")}";</script>`;
  const hits = findKeys(Buffer.from(report), "index.html");
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^index\.html \(base64 at \d+\) > report\.json$/);
});

test("an archive it cannot read is a finding; base64 noise is not", () => {
  const truncated = zip({ "a.txt": "x" }).subarray(0, 40);
  assert.deepEqual(findKeys(truncated, "broken.zip"), ["broken.zip (uninspectable archive: no end of central directory)"]);
  assert.equal(readZip(truncated).entries.length, 0);
  // A sha256 hex digest is a 64-character base64 run that decodes to noise.
  assert.deepEqual(findKeys(Buffer.from("f".repeat(64)), "hash.txt"), []);
});

test("scans directories recursively and ignores missing paths", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aeolus-credential-scan-"));
  try {
    mkdirSync(path.join(dir, "spec-chromium"));
    writeFileSync(path.join(dir, "spec-chromium", "clean.txt"), "ok");
    assert.deepEqual(scanPaths([dir, path.join(dir, "missing")]), { scanned: 1, findings: [] });
    writeFileSync(path.join(dir, "spec-chromium", "error-context.md"), KEY);
    const { scanned, findings } = scanPaths([dir]);
    assert.equal(scanned, 2);
    assert.deepEqual(findings, [path.join(dir, "spec-chromium", "error-context.md")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every E2E screenshot goes through the masked helper", () => {
  const e2e = path.join(ROOT, "e2e");
  const offenders = readdirSync(e2e)
    .filter((name) => name.endsWith(".ts") && name !== "credential-safety.ts")
    .filter((name) => /\.screenshot\s*\(/.test(readFileSync(path.join(e2e, name), "utf8")));
  assert.deepEqual(offenders, [], "call maskedScreenshot() from e2e/credential-safety.ts instead");
  const helper = readFileSync(path.join(e2e, "credential-safety.ts"), "utf8");
  const calls = helper.match(/page\.screenshot\(\{[^}]*\}\)/g) ?? [];
  assert.equal(calls.length, 1);
  assert.match(calls[0], /mask: masks/);
});

test("the key-handling spec records no trace or video and never types the key with fill", () => {
  const spec = readFileSync(path.join(ROOT, "e2e", "project-endpoints.spec.ts"), "utf8");
  assert.match(spec, /^test\.use\(\{ trace: "off", video: "off", screenshot: "off" \}\);$/m);
  assert.doesNotMatch(spec, /\.fill\(key\)/);
  assert.doesNotMatch(spec, /toMatch\(\/\^aeo_/);
  const config = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
  assert.match(config, /globalTeardown: "\.\/e2e\/global-teardown\.ts"/);
});
