import { describe, it, expect } from "vitest";
import {
  MAX_SHARED_STATE_NAME_LENGTH,
  MAX_SHARED_STATE_VALUE_BYTES,
  validateSharedStateName,
  validateSharedStatePattern,
  validateSharedStateValue,
} from "./shared-state-limits.js";

describe("validateSharedStateName", () => {
  it("accepts ordinary identifiers", () => {
    for (const name of ["bunker-summary", "power", "mine_summary", "sensor.outside", "a"]) {
      expect(validateSharedStateName("bucket", name), name).toBeNull();
    }
  });

  it("accepts the prefixed names existing installs already hold", () => {
    // The showcase seed ledger predates these bounds; introducing them must not
    // orphan state written before they existed.
    expect(validateSharedStateName("bucket", "_showcase:seed-ledger")).toBeNull();
    expect(validateSharedStateName("key", "automation:farm-water")).toBeNull();
    expect(validateSharedStateName("key", "tab:default-dashboard")).toBeNull();
  });

  it("rejects characters that would make the reactive path ambiguous", () => {
    // A value is addressed as `<bucket>/<key>` and matched with +/# wildcards, so
    // a name carrying those would have several possible paths, or act as a wildcard.
    expect(validateSharedStateName("bucket", "bunker/summary")).toMatch(/'\/'/);
    expect(validateSharedStateName("bucket", "bunker+")).toMatch(/'\+'/);
    expect(validateSharedStateName("bucket", "bunker#")).toMatch(/'#'/);
  });

  it("rejects path navigation as a whole name but allows a dot inside one", () => {
    expect(validateSharedStateName("key", ".")).toMatch(/'\.' or '\.\.'/);
    expect(validateSharedStateName("key", "..")).toMatch(/'\.' or '\.\.'/);
    // A dot is only dangerous when the name IS navigation.
    expect(validateSharedStateName("key", "outside.temp")).toBeNull();
    expect(validateSharedStateName("key", "...")).toBeNull();
  });

  it("rejects an empty or over-long name", () => {
    expect(validateSharedStateName("bucket", "")).toMatch(/required/);
    expect(validateSharedStateName("bucket", "x".repeat(MAX_SHARED_STATE_NAME_LENGTH))).toBeNull();
    expect(validateSharedStateName("bucket", "x".repeat(MAX_SHARED_STATE_NAME_LENGTH + 1))).toMatch(/exceeds/);
  });

  it("rejects control characters that would make a path unprintable", () => {
    expect(validateSharedStateName("key", "power\n")).toMatch(/control characters/);
    expect(validateSharedStateName("key", "power\u0000")).toMatch(/control characters/);
  });

  it("names the offending field so the message is actionable", () => {
    expect(validateSharedStateName("bucket", "")).toContain("bucket");
    expect(validateSharedStateName("key", "")).toContain("key");
  });
});

describe("validateSharedStatePattern", () => {
  it("accepts an exact two-segment path", () => {
    expect(validateSharedStatePattern("bunker-summary/power")).toBeNull();
  });

  it("accepts the wildcard forms a Shared State path can take", () => {
    for (const pattern of [
      "bunker-summary/#",
      "bunker-summary/+",
      "+/power",
      "+/+",
      "+/#",
      "#",
    ]) {
      expect(validateSharedStatePattern(pattern), pattern).toBeNull();
    }
  });

  it("rejects an empty pattern", () => {
    expect(validateSharedStatePattern("")).toMatch(/required/);
    expect(validateSharedStatePattern("   ")).toMatch(/required/);
  });

  it("rejects surrounding whitespace rather than silently trimming it", () => {
    expect(validateSharedStatePattern(" bunker-summary/power")).toMatch(/whitespace/);
    expect(validateSharedStatePattern("bunker-summary/power ")).toMatch(/whitespace/);
  });

  it("rejects more than two segments, which could never match a path", () => {
    // A stored value's path is exactly `<bucket>/<key>`. Accepting `a/b/c` would be
    // a trap: it validates and then never fires.
    expect(validateSharedStatePattern("a/b/c")).toMatch(/at most two segments/);
    expect(validateSharedStatePattern("a/b/#")).toMatch(/at most two segments/);
  });

  it("rejects an empty segment", () => {
    expect(validateSharedStatePattern("bunker-summary/")).toMatch(/empty segment/);
    expect(validateSharedStatePattern("/power")).toMatch(/empty segment/);
  });

  it("requires '#' to be the final segment", () => {
    expect(validateSharedStatePattern("#/power")).toMatch(/final segment/);
  });

  it("requires wildcards to be whole segments", () => {
    // `bunker+/power` is not "bucket starting with bunker" — partial wildcards are
    // not a thing in this syntax, so accepting the string would mislead.
    expect(validateSharedStatePattern("bunker+/power")).toMatch(/whole segments/);
    expect(validateSharedStatePattern("bunker-summary/po#wer")).toMatch(/whole segments/);
  });

  it("holds a literal segment to the same rules a written name obeys", () => {
    // Otherwise a pattern could reference a path that can never exist.
    expect(validateSharedStatePattern("./power")).toMatch(/'\.' or '\.\.'/);
    expect(validateSharedStatePattern(`${"x".repeat(201)}/power`)).toMatch(/exceeds/);
  });
});

describe("validateSharedStateValue", () => {
  it("accepts a value at the ceiling", () => {
    expect(validateSharedStateValue("x".repeat(MAX_SHARED_STATE_VALUE_BYTES))).toBeNull();
  });

  it("refuses a value one byte over", () => {
    expect(validateSharedStateValue("x".repeat(MAX_SHARED_STATE_VALUE_BYTES + 1))).toMatch(/exceeds/);
  });

  it("measures bytes rather than characters", () => {
    // A multi-byte character must not buy extra room: the bound protects the disk,
    // which stores bytes.
    const halfLimit = MAX_SHARED_STATE_VALUE_BYTES / 2;
    expect(validateSharedStateValue("€".repeat(halfLimit))).toMatch(/exceeds/);
  });

  it("reports the actual size so the message is actionable", () => {
    const rejection = validateSharedStateValue("x".repeat(MAX_SHARED_STATE_VALUE_BYTES + 10));
    expect(rejection).toContain(String(MAX_SHARED_STATE_VALUE_BYTES + 10));
  });
});
