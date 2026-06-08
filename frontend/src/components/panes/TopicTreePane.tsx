// frontend/src/components/panes/TopicTreePane.tsx — Pane wrapper for TopicTree

import type { PaneConfig } from "../../types/dashboard";
import { TopicTree } from "../TopicTree";

interface Props {
  config: PaneConfig;
}

export function TopicTreePane({ config: _config }: Props) {
  return <TopicTree />;
}
