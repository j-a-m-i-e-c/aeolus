// frontend/src/components/ActivityFeed.test.tsx — Recent execution feed

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

import { ActivityFeed } from "./ActivityFeed";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("ActivityFeed", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it("shows a loading state initially", () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ActivityFeed ruleId="r1" />);
    expect(screen.getByText("Loading activity…")).toBeInTheDocument();
  });

  it("shows the empty state when no entries exist", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([]));
    render(<ActivityFeed ruleId="r1" />);
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("shows an error state when fetch fails", async () => {
    mockAuthFetch.mockRejectedValue(new Error("fail"));
    render(<ActivityFeed ruleId="r1" />);
    expect(await screen.findByText("Unable to load activity")).toBeInTheDocument();
  });

  it("renders activity entries with actions", async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse([
      {
        id: "e1",
        ruleId: "r1",
        ruleName: "Heat Rule",
        ruleType: "script",
        triggerTopic: "sensor/temp",
        actions: [
          { type: "log", target: "console", success: true },
          { type: "mqtt", target: "light/bedroom", success: false, error: "timeout" },
        ],
        duration: 12,
        timestamp: Date.now(),
      },
    ]));
    render(<ActivityFeed ruleId="r1" />);
    await waitFor(() => expect(screen.getByText("log")).toBeInTheDocument());
    expect(screen.getByText("console")).toBeInTheDocument();
    expect(screen.getByText("light/bedroom")).toBeInTheDocument();
    expect(screen.getByText("(timeout)")).toBeInTheDocument();
  });
});
