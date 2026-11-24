import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { automationProjectModelUri } from "../lib/automation-project-model";

const editorHarness = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: Record<string, unknown>) => {
    editorHarness.props = props;
    return createElement("pre", { "data-testid": "monaco-editor" }, `${String(props.path ?? "")}\n${String(props.defaultValue ?? "")}`);
  },
}));
vi.mock("../lib/monaco-setup", () => ({}));
vi.mock("./endpoints/EndpointsPanel", () => ({
  EndpointsPanel: (props: { automationId: string; savedRevision: number | null; unsavedChanges: boolean }) =>
    createElement("div", { "data-testid": "endpoints-panel" }, `${props.automationId}:${props.savedRevision}:${props.unsavedChanges}`),
}));

import { AutomationProjectEditor, type AutomationProjectSource } from "./AutomationProjectEditor";

const PROJECT: AutomationProjectSource = {
  logicEntry: "logic/index.ts",
  uiEntry: "ui/index.tsx",
  files: [
    { path: "logic/index.ts", content: "export default async function run() { return 'logic'; }" },
    { path: "ui/index.tsx", content: "export default function View() { return <div>ui</div>; }" },
    { path: "logic/policy.ts", content: "export const policy = true;" },
  ],
};

describe("AutomationProjectEditor Monaco model identity", () => {
  it("namespaces identical file paths by automation identity", () => {
    const water = automationProjectModelUri("farm-water", "logic/index.ts");
    const energy = automationProjectModelUri("farm-energy", "logic/index.ts");

    expect(water).not.toBe(energy);
    expect(water).toContain("farm-water");
    expect(energy).toContain("farm-energy");
  });

  it("keeps files inside the same project namespace", () => {
    expect(automationProjectModelUri("space", "logic/index.ts")).toBe(
      "file:///aeolus-project/space/logic/index.ts",
    );
    expect(automationProjectModelUri("space", "ui/index.tsx")).toBe(
      "file:///aeolus-project/space/ui/index.tsx",
    );
  });
});

describe("AutomationProjectEditor local editing model switching", () => {
  it("keeps Monaco changes wired while shared source persistence is read-only", () => {
    const onChange = vi.fn();
    render(
      createElement(AutomationProjectEditor, {
        project: PROJECT,
        projectKey: "farm-water",
        readOnly: true,
        onChange,
      }),
    );

    expect(editorHarness.props?.onChange).toEqual(expect.any(Function));
    expect(editorHarness.props?.value).toBeUndefined();
    expect((editorHarness.props?.options as { readOnly?: boolean })?.readOnly).toBe(false);
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("logic/index.ts");
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("return 'logic'");

    fireEvent.click(screen.getByRole("button", { name: "UI" }));
    expect(editorHarness.props?.onChange).toEqual(expect.any(Function));
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("ui/index.tsx");
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("<div>ui</div>");

    fireEvent.click(screen.getByRole("button", { name: "Logic" }));
    expect(editorHarness.props?.onChange).toEqual(expect.any(Function));
    expect(editorHarness.props?.value).toBeUndefined();
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("logic/index.ts");
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("return 'logic'");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps Monaco changes wired for editable projects", () => {
    render(
      createElement(AutomationProjectEditor, {
        project: PROJECT,
        projectKey: "farm-water",
        readOnly: false,
        onChange: vi.fn(),
      }),
    );

    expect(editorHarness.props?.value).toBeUndefined();
    expect(editorHarness.props?.onChange).toEqual(expect.any(Function));
  });
});

describe("AutomationProjectEditor Endpoints view", () => {
  it("is absent unless the host offers it", () => {
    render(createElement(AutomationProjectEditor, { project: PROJECT, projectKey: "farm-water", onChange: vi.fn() }));
    expect(screen.queryByRole("button", { name: /Endpoints/ })).not.toBeInTheDocument();
    // The API reference stays where it was.
    fireEvent.click(screen.getByRole("button", { name: "API" }));
    expect(screen.getByText("Logic API")).toBeInTheDocument();
  });

  it("replaces the code area without unmounting Monaco, and Logic returns to it", () => {
    render(createElement(AutomationProjectEditor, {
      project: PROJECT,
      projectKey: "farm-water",
      onChange: vi.fn(),
      endpoints: { automationId: "farm-water", savedRevision: 7, unsavedChanges: true },
    }));
    const tab = screen.getByRole("button", { name: /Endpoints/ });
    expect(tab).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("endpoints-panel")).toHaveTextContent("farm-water:7:true");
    // Still mounted, only hidden, so the editor's models and undo history survive.
    expect(screen.getByTestId("monaco-editor").closest("section")).toHaveClass("hidden");

    // A tool closes the Endpoints view and opens on the code.
    fireEvent.click(screen.getByRole("button", { name: "API" }));
    expect(screen.queryByTestId("endpoints-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Logic API")).toBeInTheDocument();

    fireEvent.click(tab);
    fireEvent.click(screen.getByRole("button", { name: "Logic" }));
    expect(screen.queryByTestId("endpoints-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor").closest("section")).not.toHaveClass("hidden");
  });
});
