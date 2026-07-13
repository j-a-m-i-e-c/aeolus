// frontend/src/components/WelcomeScreen.test.tsx — Onboarding screen render + navigation

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

import { WelcomeScreen } from "./WelcomeScreen";

describe("WelcomeScreen", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it("renders the welcome heading and the three onboarding cards", () => {
    render(<WelcomeScreen />);
    expect(screen.getByText("Welcome to Aeolus")).toBeInTheDocument();
    expect(screen.getByText("Publish MQTT Data")).toBeInTheDocument();
    expect(screen.getByText("Connect Devices")).toBeInTheDocument();
    expect(screen.getByText("Write Automations")).toBeInTheDocument();
  });

  it("navigates to the connectors page when 'Connect Devices' is clicked", () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByText("Connect Devices"));
    expect(mockNavigate).toHaveBeenCalledWith("/connectors");
  });
});
