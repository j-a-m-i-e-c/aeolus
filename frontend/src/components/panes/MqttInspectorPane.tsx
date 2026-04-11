// frontend/src/components/panes/MqttInspectorPane.tsx — Pane wrapper for MqttInspector

import type { PaneConfig } from "../../types/dashboard";
import { MqttInspector } from "../MqttInspector";

interface Props {
  config: PaneConfig;
}

export function MqttInspectorPane({ config }: Props) {
  return <MqttInspector />;
}
