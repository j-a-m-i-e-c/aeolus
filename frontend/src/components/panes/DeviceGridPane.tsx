// frontend/src/components/panes/DeviceGridPane.tsx — Pane wrapper for DeviceGrid

import type { PaneConfig } from "../../types/dashboard";
import { DeviceGrid } from "../DeviceGrid";

interface Props {
  config: PaneConfig;
}

export function DeviceGridPane({ config }: Props) {
  return <DeviceGrid />;
}
