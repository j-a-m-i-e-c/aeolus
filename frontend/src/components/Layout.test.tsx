// frontend/src/components/Layout.test.tsx — Sidebar shell wraps its children

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The real Sidebar pulls in routing + several stores; stub it since Layout's
// only responsibility is to compose the sidebar with a <main> content region
// and own the mobile navigation open/closed state. The stub surfaces the props
// Layout passes down so that wiring can be asserted.
vi.mock("./Sidebar", () => ({
  Sidebar: ({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) => (
    <nav data-testid="sidebar" data-mobile-open={String(Boolean(mobileOpen))}>
      sidebar
      <button type="button" onClick={() => onClose?.()}>sidebar-close</button>
    </nav>
  ),
}));

import { Layout } from "./Layout";

describe("Layout", () => {
  it("renders the sidebar alongside the provided children", () => {
    render(
      <Layout>
        <p>page content</p>
      </Layout>,
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("places children inside the main content region", () => {
    render(
      <Layout>
        <span>inner</span>
      </Layout>,
    );
    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    expect(main).toHaveTextContent("inner");
  });

  // The narrow-viewport shell: the sidebar is hidden behind a hamburger, and
  // Layout owns whether it is open. There is no scrim to dismiss until it is.
  describe("mobile navigation", () => {
    const trigger = () => screen.getByRole("button", { name: "Open navigation" });
    const scrim = () => screen.queryByRole("button", { name: "Close navigation" });

    it("starts closed, with no dismiss scrim", () => {
      render(<Layout><span>inner</span></Layout>);
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-mobile-open", "false");
      expect(scrim()).not.toBeInTheDocument();
    });

    it("opens the sidebar and shows a dismiss scrim when the trigger is pressed", () => {
      render(<Layout><span>inner</span></Layout>);
      fireEvent.click(trigger());
      expect(trigger()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-mobile-open", "true");
      expect(scrim()).toBeInTheDocument();
    });

    it("closes again when the scrim is pressed", () => {
      render(<Layout><span>inner</span></Layout>);
      fireEvent.click(trigger());
      fireEvent.click(scrim()!);
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-mobile-open", "false");
      expect(scrim()).not.toBeInTheDocument();
    });

    it("closes when the sidebar itself requests it, e.g. after navigating", () => {
      render(<Layout><span>inner</span></Layout>);
      fireEvent.click(trigger());
      fireEvent.click(screen.getByRole("button", { name: "sidebar-close" }));
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-mobile-open", "false");
      expect(scrim()).not.toBeInTheDocument();
    });
  });
});
