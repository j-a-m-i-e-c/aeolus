// frontend/src/lib/topic-filter.test.ts — mirror of the backend matcher/validator

import { describe, it, expect } from "vitest";
import { matchesTopicFilter, matchesAnyFilter, isValidTopicFilter } from "./topic-filter";

describe("matchesTopicFilter", () => {
  it("matches exact topics", () => {
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen/fan")).toBe(false);
  });

  it("matches a single level with +", () => {
    expect(matchesTopicFilter("home/+/light", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("home/+/light", "home/light")).toBe(false);
    expect(matchesTopicFilter("home/+/light", "home/a/b/light")).toBe(false);
  });

  it("matches remaining levels with #", () => {
    expect(matchesTopicFilter("home/#", "home")).toBe(true);
    expect(matchesTopicFilter("home/#", "home/kitchen/light")).toBe(true);
    expect(matchesTopicFilter("#", "anything/here")).toBe(true);
  });

  it("rejects a differing literal level and a shorter topic", () => {
    expect(matchesTopicFilter("locks/+/state", "sensors/door/state")).toBe(false);
    expect(matchesTopicFilter("home/kitchen/light", "home/kitchen")).toBe(false);
  });

  it("treats empty inputs as no match", () => {
    expect(matchesTopicFilter("", "home")).toBe(false);
    expect(matchesTopicFilter("home/#", "")).toBe(false);
  });
});

describe("matchesAnyFilter", () => {
  it("is true when any filter matches, false otherwise", () => {
    expect(matchesAnyFilter(["a/#", "b/+"], "b/x")).toBe(true);
    expect(matchesAnyFilter(["a/#", "b/+"], "c/x")).toBe(false);
    expect(matchesAnyFilter([], "anything")).toBe(false);
  });
});

describe("isValidTopicFilter", () => {
  it("accepts plain and wildcard filters", () => {
    expect(isValidTopicFilter("home/kitchen/light")).toBe(true);
    expect(isValidTopicFilter("home/+/light")).toBe(true);
    expect(isValidTopicFilter("home/#")).toBe(true);
    expect(isValidTopicFilter("#")).toBe(true);
    expect(isValidTopicFilter("+")).toBe(true);
  });

  it("permits empty levels per the MQTT spec", () => {
    expect(isValidTopicFilter("a//b")).toBe(true);
  });

  it("rejects empty, over-long, and null-containing filters", () => {
    expect(isValidTopicFilter("")).toBe(false);
    expect(isValidTopicFilter("a".repeat(65536))).toBe(false);
    expect(isValidTopicFilter("a/\u0000/b")).toBe(false);
  });

  it("rejects # that is not a whole, final level", () => {
    expect(isValidTopicFilter("sport/#/x")).toBe(false);
    expect(isValidTopicFilter("sport#")).toBe(false);
  });

  it("rejects + that does not occupy a whole level", () => {
    expect(isValidTopicFilter("sport+")).toBe(false);
  });
});
