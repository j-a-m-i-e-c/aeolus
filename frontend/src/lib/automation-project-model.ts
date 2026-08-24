/**
 * Stable Monaco URI for one file in one Automation Project.
 *
 * Monaco keeps models alive while the project editor switches files. The
 * automation identity is therefore part of the URI so two projects that both
 * contain `logic/index.ts` can never share the same model.
 */
export function automationProjectModelUri(projectKey: string, filePath: string): string {
  const namespace = encodeURIComponent(projectKey || "project");
  return `file:///aeolus-project/${namespace}/${filePath}`;
}
