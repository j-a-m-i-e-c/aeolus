// frontend/src/components/panes/AutomationsEditorPane.tsx — Pane wrapper for the full AutomationsPage editor

import type { PaneConfig } from "../../types/dashboard";
import { AutomationsPage } from "../AutomationsPage";

interface Props {
  config: PaneConfig;
}

export function AutomationsEditorPane({ config }: Props) {
  return <AutomationsPage />;
}
