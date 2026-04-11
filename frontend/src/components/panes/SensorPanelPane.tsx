// frontend/src/components/panes/SensorPanelPane.tsx — Pane wrapper for SensorPanel

import type { PaneConfig } from "../../types/dashboard";
import { SensorPanel } from "../SensorPanel";

interface Props {
  config: PaneConfig;
}

export function SensorPanelPane({ config }: Props) {
  return <SensorPanel />;
}
