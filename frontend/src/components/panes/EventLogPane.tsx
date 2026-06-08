// frontend/src/components/panes/EventLogPane.tsx — Pane wrapper for EventLog

import type { PaneConfig } from "../../types/dashboard";
import { EventLog } from "../EventLog";

interface Props {
  config: PaneConfig;
}

export function EventLogPane({ config: _config }: Props) {
  return <EventLog />;
}
