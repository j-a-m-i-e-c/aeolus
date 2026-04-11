// frontend/src/components/panes/SystemStatsPane.tsx — Pane wrapper for SystemPage

import type { PaneConfig } from "../../types/dashboard";
import { SystemPage } from "../SystemPage";

interface Props {
  config: PaneConfig;
}

export function SystemStatsPane({ config }: Props) {
  return <SystemPage />;
}
