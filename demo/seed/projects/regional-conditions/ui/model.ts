// Types describe the data exchanged between the showcase Logic and UI.
// Keep optional/null fields honest: a source may not have reported yet.
export type RiverGauge = {
  id: string; name: string; lon: number; lat: number;
  level: number | null; observedAt: number | null;
  quality: 'checked' | 'unchecked' | 'suspect' | null;
  qualityNote: string; change1h: number | null;
};
export type RainGauge = {
  id: string; name: string; lon: number; lat: number;
  lastHourMm: number | null; observedAt: number | null;
  total24h: number | null; hoursCovered: number; suspect: boolean;
};
export type FireIncident = {
  id: string; title: string; alert: string; status: string; type: string;
  council: string; location: string; size: string; agency: string;
  updated: string; lon: number | null; lat: number | null;
};
export type FireDangerReport = {
  district: string; today: string; tomorrow: string;
  fireBanToday: boolean | null; fireBanTomorrow: boolean | null;
};
export type RadarFrame = {
  capturedAt: number; grid: string; palette: string[];
  size: number; bounds: number[];
};
export type RiverSample = { t: number; v: number; suspect: boolean };
export type RainSample = { t: number; mm: number; suspect: boolean };
export type GaugeHistory<T> = Record<string, T[]>;
export type ConditionsModel = {
  radarFrames: RadarFrame[];
  riverGauges: RiverGauge[]; riverHistory: GaugeHistory<RiverSample>;
  riverUpdated: number | null; riverError: string | null;
  rainGauges: RainGauge[]; rainHistory: GaugeHistory<RainSample>;
  rainUpdated: number | null; rainError: string | null;
  fireDanger: FireDangerReport | null;
  fireDangerUpdated: number | null; fireDangerError: string | null;
  incidents: FireIncident[]; incidentsUpdated: number | null;
  incidentsError: string | null; lastFetchAttempt: number | null;
};
