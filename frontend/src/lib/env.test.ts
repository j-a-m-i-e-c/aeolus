// frontend/src/lib/env.test.ts — Unit tests for centralized base URLs

import { describe, it, expect } from "vitest";
import { API_URL, WS_URL } from "./env";

describe("env base URLs", () => {
  it("derives API_URL from the current hostname and backend port by default", () => {
    // No VITE_API_URL set in the test env, so it falls back to the host default.
    expect(API_URL).toBe(`http://${window.location.hostname}:3001`);
  });

  it("derives WS_URL from the current hostname with the /ws path", () => {
    expect(WS_URL).toBe(`ws://${window.location.hostname}:3001/ws`);
  });
});
