// frontend/src/components/SnippetPicker.test.tsx — Code snippet picker

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

import { SnippetPicker } from "./SnippetPicker";

const API_SNIPPETS = [
  {
    category: "MQTT",
    icon: "radio",
    snippets: [
      { id: "s1", name: "Publish", description: "Publish a message", code: "mqtt.publish('a','b')" },
      { id: "s2", name: "Subscribe", description: "Subscribe to topic", code: "mqtt.sub('a')" },
    ],
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("SnippetPicker", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(jsonResponse(API_SNIPPETS));
  });

  it("shows a loading state then renders snippet groups", async () => {
    render(<SnippetPicker onInsert={() => {}} />);
    expect(screen.getByText("Loading snippets…")).toBeInTheDocument();
    expect(await screen.findByText("MQTT")).toBeInTheDocument();
  });

  it("expands a group and shows snippets", async () => {
    render(<SnippetPicker onInsert={() => {}} />);
    await screen.findByText("MQTT");
    // First group auto-expanded
    expect(screen.getByText("Publish")).toBeInTheDocument();
    expect(screen.getByText("Subscribe")).toBeInTheDocument();
  });

  it("calls onInsert with the snippet code when clicked", async () => {
    const onInsert = vi.fn();
    render(<SnippetPicker onInsert={onInsert} />);
    await screen.findByText("Publish");
    fireEvent.click(screen.getByText("Publish"));
    expect(onInsert).toHaveBeenCalledWith("mqtt.publish('a','b')");
  });

  it("filters snippets by search query", async () => {
    render(<SnippetPicker onInsert={() => {}} />);
    await screen.findByText("Publish");
    fireEvent.change(screen.getByPlaceholderText("Search snippets…"), { target: { value: "Subscribe" } });
    expect(screen.queryByText("Publish")).not.toBeInTheDocument();
    expect(screen.getByText("Subscribe")).toBeInTheDocument();
  });

  it("shows 'No snippets match' when search has no results", async () => {
    render(<SnippetPicker onInsert={() => {}} />);
    await screen.findByText("Publish");
    fireEvent.change(screen.getByPlaceholderText("Search snippets…"), { target: { value: "zzzzz" } });
    expect(screen.getByText(/No snippets match/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<SnippetPicker onInsert={() => {}} onClose={onClose} />);
    await screen.findByText("Publish");
    fireEvent.click(screen.getByTitle("Close snippets"));
    expect(onClose).toHaveBeenCalled();
  });

  it("in UI mode, falls back to hardcoded snippets if API fails", async () => {
    mockAuthFetch.mockRejectedValue(new Error("fail"));
    render(<SnippetPicker onInsert={() => {}} mode="ui" />);
    // Should still render the hardcoded UI snippets
    await waitFor(() => expect(screen.getByText("Status Card")).toBeInTheDocument());
  });
});
