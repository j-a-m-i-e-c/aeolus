// frontend/src/components/SnippetPicker.test.tsx — Unit tests for SnippetPicker

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

// SnippetPicker uses import.meta.env.VITE_API_URL at module level — vitest handles it via .env

import { SnippetPicker } from "./SnippetPicker";

const MOCK_SNIPPETS = [
  {
    category: "MQTT",
    icon: "radio",
    snippets: [
      { id: "mqtt-pub", name: "Publish", description: "Publish a message", code: "mqtt.publish('topic', 'msg');" },
      { id: "mqtt-sub", name: "Subscribe", description: "Subscribe to topic", code: "mqtt.subscribe('topic');" },
    ],
  },
  {
    category: "Devices",
    icon: "cpu",
    snippets: [
      { id: "dev-toggle", name: "Toggle", description: "Toggle a device", code: "devices.action('id', 'toggle');" },
    ],
  },
];

describe("SnippetPicker", () => {
  const onInsert = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onInsert.mockReset();
    onClose.mockReset();
    mockAuthFetch.mockReset();
  });

  function renderWithLogicMode() {
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_SNIPPETS,
    });
    return render(<SnippetPicker onInsert={onInsert} onClose={onClose} mode="logic" />);
  }

  it("shows loading state initially", () => {
    mockAuthFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SnippetPicker onInsert={onInsert} mode="logic" />);
    expect(screen.getByText("Loading snippets…")).toBeInTheDocument();
  });

  it("fetches snippets from the API and displays groups", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("MQTT")).toBeInTheDocument());
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("first group is expanded by default showing its snippets", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    expect(screen.getByText("Subscribe")).toBeInTheDocument();
  });

  it("toggling a collapsed group expands it", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Devices")).toBeInTheDocument());
    // Devices group starts collapsed
    expect(screen.queryByText("Toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Devices"));
    expect(screen.getByText("Toggle")).toBeInTheDocument();
  });

  it("toggling an expanded group collapses it", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MQTT"));
    expect(screen.queryByText("Publish")).not.toBeInTheDocument();
  });

  it("calls onInsert with snippet code when clicked", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Publish"));
    expect(onInsert).toHaveBeenCalledWith("mqtt.publish('topic', 'msg');");
  });

  it("shows 'Inserted' indicator briefly after insert", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Publish"));
    expect(screen.getByText("Inserted")).toBeInTheDocument();
  });

  it("filters snippets by search query", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search snippets…"), { target: { value: "toggle" } });
    // MQTT group should be hidden (no matching snippets)
    expect(screen.queryByText("MQTT")).not.toBeInTheDocument();
    // Devices group should remain visible since it has a matching snippet
    expect(screen.getByText("Devices")).toBeInTheDocument();
    // Expand the filtered Devices group to see the snippet
    fireEvent.click(screen.getByText("Devices"));
    expect(screen.getByText("Toggle")).toBeInTheDocument();
  });

  it("shows no-results message when search has no matches", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Publish")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search snippets…"), { target: { value: "zzznomatch" } });
    expect(screen.getByText(/No snippets match/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    renderWithLogicMode();
    await waitFor(() => expect(screen.getByText("Snippets")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Close snippets"));
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to hardcoded UI snippets when API fails in UI mode", async () => {
    mockAuthFetch.mockRejectedValue(new Error("network"));
    render(<SnippetPicker onInsert={onInsert} mode="ui" />);
    await waitFor(() => expect(screen.getByText("General")).toBeInTheDocument());
    expect(screen.getByText("Status Card")).toBeInTheDocument();
  });

  it("does not render anything when groups are empty and not loading", async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => [] });
    const { container } = render(<SnippetPicker onInsert={onInsert} mode="logic" />);
    await waitFor(() => expect(screen.queryByText("Loading snippets…")).not.toBeInTheDocument());
    // When groups are empty, the component returns null
    expect(container.firstChild).toBeNull();
  });
});
