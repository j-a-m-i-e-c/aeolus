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

describe("AutomationProjectEditor read-only model switching", () => {
  it("does not subscribe Monaco changes while shared source is read-only", () => {
    const onChange = vi.fn();
    render(
      createElement(AutomationProjectEditor, {
        project: PROJECT,
        projectKey: "farm-water",
        readOnly: true,
        onChange,
      }),
    );

    expect(editorHarness.props?.onChange).toBeUndefined();
    expect(editorHarness.props?.value).toBeUndefined();
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("logic/index.ts");
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("return 'logic'");

    fireEvent.click(screen.getByRole("button", { name: "UI" }));
    expect(editorHarness.props?.onChange).toBeUndefined();
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("ui/index.tsx");
    expect(screen.getByTestId("monaco-editor")).toHaveTextContent("<div>ui</div>");

    fireEvent.click(screen.getByRole("button", { name: "Logic" }));
    expect(editorHarness.props?.onChange).toBeUndefined();
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
