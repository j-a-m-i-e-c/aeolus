// frontend/src/components/panes/ConnectorsPane.tsx — Pane wrapper for ConnectorsPage

import type { PaneConfig } from "../../types/dashboard";
import { ConnectorsPage } from "../ConnectorsPage";

interface Props {
  config: PaneConfig;
}

export function ConnectorsPane({ config: _config }: Props) {
  return <ConnectorsPage />;
}
