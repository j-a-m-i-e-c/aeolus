import { describe, it, expect } from "vitest";
import { matchesTopicFilter, isValidTopicFilter } from "./topic-filter.js";

describe("matchesTopicFilter", () => {
  it("matches an exact topic", () => {
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen/fan")).toBe(false);
  });

  it("matches a single level with +", () => {
    expect(matchesTopicFilter("home/+/light", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("home/+/light", "home/bedroom/light")).toBe(true);
    // + is exactly one level, not zero and not many
    expect(matchesTopicFilter("home/+/light", "home/light")).toBe(false);
    expect(matchesTopicFilter("home/+/light", "home/kitchen/ceiling/light")).toBe(false);
  });

  it("matches the remaining levels with #", () => {
    expect(matchesTopicFilter("home/#", "home")).toBe(true);
    expect(matchesTopicFilter("home/#", "home/kitchen")).toBe(true);
    expect(matchesTopicFilter("home/#", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("home/#", "office/kitchen")).toBe(false);
  });

  it("matches everything with a bare #", () => {
    expect(matchesTopicFilter("#", "anything")).toBe(true);
    expect(matchesTopicFilter("#", "a/b/c")).toBe(true);
  });

  it("does not match when a literal level differs", () => {
    expect(matchesTopicFilter("locks/+/state", "sensors/door/state")).toBe(false);
  });

  it("does not match a shorter topic against a longer literal filter", () => {
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen")).toBe(false);
  });

  it("treats an empty filter or topic as no match (fail-closed)", () => {
    expect(matchesTopicFilter("", "home/kitchen")).toBe(false);
    expect(matchesTopicFilter("home/#", "")).toBe(false);
  });
});

describe("isValidTopicFilter", () => {
  it("accepts plain and wildcard filters", () => {
    expect(isValidTopicFilter("home/kitchen/light")).toBe(true);
    expect(isValidTopicFilter("home/+/light")).toBe(true);
    expect(isValidTopicFilter("home/#")).toBe(true);
    expect(isValidTopicFilter("#")).toBe(true);
    expect(isValidTopicFilter("+")).toBe(true);
    expect(isValidTopicFilter("+/+/status")).toBe(true);
  });

  it("permits empty levels per the MQTT spec", () => {
    expect(isValidTopicFilter("a//b")).toBe(true);
    expect(isValidTopicFilter("/leading")).toBe(true);
  });

  it("rejects an empty filter", () => {
    expect(isValidTopicFilter("")).toBe(false);
  });

  it("rejects # that is not a whole, final level", () => {
    expect(isValidTopicFilter("sport/#/x")).toBe(false);
    expect(isValidTopicFilter("sport#")).toBe(false);
    expect(isValidTopicFilter("#/x")).toBe(false);
  });

  it("rejects + that does not occupy a whole level", () => {
    expect(isValidTopicFilter("sport+")).toBe(false);
    expect(isValidTopicFilter("a/b+c/d")).toBe(false);
  });

  it("rejects a null character and over-long filters", () => {
    expect(isValidTopicFilter("a/\u0000/b")).toBe(false);
    expect(isValidTopicFilter("a".repeat(65536))).toBe(false);
  });
});
