// frontend/src/components/Layout.test.tsx — Sidebar shell wraps its children

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The real Sidebar pulls in routing + several stores; stub it since Layout's
// only responsibility is to compose the sidebar with a <main> content region.
vi.mock("./Sidebar", () => ({
  Sidebar: () => <nav data-testid="sidebar">sidebar</nav>,
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
});
