import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { BadRequestError } from "./error-handler.js";
import {
  PreconditionRequiredError,
  mutationIdFromRequest,
  requireIfMatchRevision,
} from "./revision-precondition.js";

function requestWith(headers: Record<string, string | undefined>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe("revision preconditions", () => {
  it.each([
    ["7", 7],
    ['"7"', 7],
    ['W/"7"', 7],
    ['  W/"42"  ', 42],
  ])("accepts %s as revision %i", (raw, expected) => {
    expect(requireIfMatchRevision(requestWith({ "if-match": raw }))).toBe(expected);
  });

  it("requires If-Match", () => {
    expect(() => requireIfMatchRevision(requestWith({}))).toThrow(PreconditionRequiredError);
  });

  it.each(["0", "-1", '"7', '7"', 'W/7', '"7", "8"', "abc", "7.5"])(
    "rejects malformed or unsupported validators: %s",
    (raw) => {
      expect(() => requireIfMatchRevision(requestWith({ "if-match": raw }))).toThrow(BadRequestError);
    },
  );

  it("reads a bounded opaque mutation id", () => {
    expect(mutationIdFromRequest(requestWith({ "x-aeolus-mutation-id": "  mutation-123  " }))).toBe("mutation-123");
    expect(mutationIdFromRequest(requestWith({}))).toBeNull();
    expect(mutationIdFromRequest(requestWith({ "x-aeolus-mutation-id": "x".repeat(129) }))).toBeNull();
  });
});
