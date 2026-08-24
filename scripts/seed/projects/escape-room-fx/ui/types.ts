// Editor-only type contract for this project's custom UI.
export interface CustomComponentProps {
  devices: any[];
  ruleId: string;
  ruleName: string;
  lastFired: number | null;
  enabled: boolean;
  read(key: string): unknown;
  save(key: string, value: unknown): void;
  saveAndFire(key: string, value: unknown): void;
  fire(eventName: string, payload?: Record<string, unknown>): void;
  control(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<void>;
  publish(topic: string, payload: string): void;
  history: any[];
}
