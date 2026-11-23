// src/automations/project-compile-error.ts — the error every Automation Project compile
// step throws, with the file, line and column the editor highlights.
//
// Kept apart from automation-project.ts so the Project API compiler, which the project
// compiler calls, can use it without an import cycle. automation-project.ts re-exports
// both names, so existing imports are unchanged.

export interface ProjectCompileError {
  path?: string;
  line: number;
  column: number;
  message: string;
}

export class AutomationProjectCompileError extends Error {
  constructor(public readonly details: ProjectCompileError[]) {
    super("Automation Project compilation failed");
    this.name = "AutomationProjectCompileError";
  }
}
