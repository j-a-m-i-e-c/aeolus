// scripts/e2e/credential-scan.mjs — fail if E2E artifacts contain a Project API key.
//
// The Project API spec issues a real key and uses it. Screenshots mask the key
// fields (e2e/credential-safety.ts), but text artifacts can still carry it: an
// error-context page snapshot, a report step title, a trace's network log. This
// scanner reads every file under the given directories and reports any that hold
// an `aeo_<16 hex>_<43 base64url>` key, in plain bytes, inside ZIP entries
// (traces, the HTML report's embedded data), inside gzip streams, or inside long
// base64 runs. It never prints the key itself, only the file and where it was.
//
// Pixels cannot be searched, so screenshots rely on masking instead; a file this
// scanner cannot open (a truncated archive, a ZIP64 entry) is reported, not
// skipped, because "could not look" must not read as "clean".
//
// CLI: node scripts/e2e/credential-scan.mjs <dir-or-file>... (missing paths are ignored)

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

/** The issued key format (see the Project API access store). */
export const API_KEY_PATTERN = /aeo_[0-9a-f]{16}_[A-Za-z0-9_-]{43}/;

const MAX_DEPTH = 4;
const MAX_INFLATED_BYTES = 256 * 1024 * 1024;
const BASE64_RUN = /[A-Za-z0-9+/]{64,}={0,2}/g;
const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

/**
 * Where a buffer holds a key, as a list of container paths (empty when clean).
 * `where` describes each hit, e.g. "trace.zip > resources/abc", or an
 * "uninspectable" reason when an archive could not be read.
 *
 * A long base64 run is decoded speculatively: most such runs are hashes or image
 * data, so a decode that only looks like a broken archive is noise, not a finding.
 * A key found inside it is always a finding.
 *
 * @param {Buffer} buffer
 * @param {string} [label]
 * @param {number} [depth]
 * @param {boolean} [speculative]
 * @returns {string[]}
 */
export function findKeys(buffer, label = "(file)", depth = 0, speculative = false) {
  const hits = [];
  const text = buffer.toString("latin1");
  if (API_KEY_PATTERN.test(text)) hits.push(label);
  if (depth >= MAX_DEPTH) return hits;

  if (isZip(buffer)) {
    const archive = readZip(buffer);
    if (archive.error && !speculative) hits.push(`${label} (uninspectable archive: ${archive.error})`);
    for (const entry of archive.entries) {
      if (entry.error) {
        if (!speculative) hits.push(`${label} > ${entry.name} (uninspectable entry: ${entry.error})`);
      }
      else hits.push(...findKeys(entry.data, `${label} > ${entry.name}`, depth + 1));
    }
  } else if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      hits.push(...findKeys(gunzipSync(buffer, { maxOutputLength: MAX_INFLATED_BYTES }), `${label} (gzip)`, depth + 1));
    } catch (error) {
      if (!speculative) hits.push(`${label} (uninspectable gzip: ${errorMessage(error)})`);
    }
  }

  for (const match of text.matchAll(BASE64_RUN)) {
    hits.push(...findKeys(Buffer.from(match[0], "base64"), `${label} (base64 at ${match.index})`, depth + 1, true));
  }
  return hits;
}

/**
 * Scan files and directories (recursively, not following symlinks).
 *
 * @param {string[]} roots
 * @returns {{ scanned: number, findings: string[] }}
 */
export function scanPaths(roots) {
  let scanned = 0;
  const findings = [];
  const visit = (target) => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(target)) visit(path.join(target, name));
      return;
    }
    if (!stat.isFile()) return;
    scanned += 1;
    findings.push(...findKeys(readFileSync(target), target));
  };
  for (const root of roots) if (existsSync(root)) visit(root);
  return { scanned, findings };
}

function isZip(buffer) {
  return buffer.length >= 22 && buffer.readUInt32LE(0) === ZIP_LOCAL;
}

/**
 * Minimal ZIP reader: central directory, stored and deflated entries.
 *
 * @param {Buffer} buffer
 * @returns {{ error?: string, entries: Array<{ name: string, data: Buffer, error?: undefined } | { name: string, error: string }> }}
 */
export function readZip(buffer) {
  const end = findEndOfCentralDirectory(buffer);
  if (end < 0) return { error: "no end of central directory", entries: [] };
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) return { error: "ZIP64 is not supported", entries: [] };
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL) {
      return { error: "corrupt central directory", entries };
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    entries.push(readEntry(buffer, name, method, compressedSize, localOffset));
  }
  return { entries };
}

function readEntry(buffer, name, method, compressedSize, localOffset) {
  if (compressedSize === 0xffffffff || localOffset === 0xffffffff) return { name, error: "ZIP64 entry" };
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL) return { name, error: "bad local header" };
  const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
  if (start + compressedSize > buffer.length) return { name, error: "truncated" };
  const raw = buffer.subarray(start, start + compressedSize);
  if (method === 0) return { name, data: raw };
  if (method !== 8) return { name, error: `compression method ${method}` };
  try {
    return { name, data: inflateRawSync(raw, { maxOutputLength: MAX_INFLATED_BYTES }) };
  } catch (error) {
    return { name, error: errorMessage(error) };
  }
}

function findEndOfCentralDirectory(buffer) {
  const stop = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END) return offset;
  }
  return -1;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    process.stderr.write("usage: node scripts/e2e/credential-scan.mjs <dir-or-file>...\n");
    process.exit(2);
  }
  const { scanned, findings } = scanPaths(roots);
  if (findings.length > 0) {
    process.stderr.write(`[e2e] credential scan FAILED: ${findings.length} finding(s) in ${roots.join(", ")}\n`);
    for (const finding of findings) process.stderr.write(`  - ${finding}\n`);
    process.stderr.write("[e2e] Do not share or upload these artifacts. Delete them and fix the leak.\n");
    process.exit(1);
  }
  process.stdout.write(`[e2e] credential scan passed: ${scanned} file(s), no API key found\n`);
}
