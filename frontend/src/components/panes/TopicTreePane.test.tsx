// frontend/src/components/panes/TopicTreePane.test.tsx — Thin wrapper renders TopicTree

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaneConfig } from "../../types/dashboard";

vi.mock("../TopicTree", () => ({
  TopicTree: () => <div data-testid="topic-tree">topic tree</div>,
}));

import { TopicTreePane } from "./TopicTreePane";

describe("TopicTreePane", () => {
  it("renders the wrapped TopicTree", () => {
    render(<TopicTreePane config={{} as PaneConfig} />);
    expect(screen.getByTestId("topic-tree")).toBeInTheDocument();
  });
});
