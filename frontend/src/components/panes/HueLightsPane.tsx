// frontend/src/components/panes/HueLightsPane.tsx — Pane wrapper for LightingPage

import type { PaneConfig } from "../../types/dashboard";
import { LightingPage } from "../LightingPage";

interface Props {
  config: PaneConfig;
}

export function HueLightsPane({ config }: Props) {
  return <LightingPage />;
}
