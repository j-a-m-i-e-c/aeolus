// Types for demo/seed/project-loader.mjs so TypeScript consumers (the
// showcase architecture test helper) can use the same loader as the seeder.

export interface SeedProjectFile {
  path: string;
  content: string;
}

export interface SeedProjectPayload {
  files: SeedProjectFile[];
  logicEntry: string;
  uiEntry: string | null;
}

export declare const PROJECTS_ROOT: string;
export declare const DEFAULT_LOGIC_ENTRY: string;
export declare const DEFAULT_UI_ENTRY: string;

export declare function readProjectFiles(projectDir: string): SeedProjectFile[];
export declare function loadProject(projectDir: string): SeedProjectPayload;
