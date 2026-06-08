// frontend/src/components/panes/AutomationRulesPane.tsx — Pane wrapper for AutomationsPage

import type { PaneConfig } from "../../types/dashboard";
import { AutomationsPage } from "../AutomationsPage";

interface Props {
  config: PaneConfig;
}

export function AutomationRulesPane({ config: _config }: Props) {
  return <AutomationsPage />;
}
