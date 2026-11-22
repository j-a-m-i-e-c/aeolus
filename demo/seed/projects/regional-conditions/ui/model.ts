// The Logic -> UI contract, and the one place it is checked.
//
// Automation State is untyped JSON, and any key can be absent: before the first fetch,
// on an install without the radar collector, or after a source has failed from the
// start. toModel() turns whatever was read into these shapes, so the components below
// it can rely on lists being lists. Null means "no reading", as the Logic writes it.

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
  capturedAt: number; grid: string; palette: string[]; size: number; bounds: number[];
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const objects = (value: unknown) => (Array.isArray(value) ? value : []).filter(isObject);
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * Shape the values read from Automation State. Lists and records are guaranteed; the
 * fields inside each entry are the Logic's own output and are not re-validated here,
 * because the renderers already treat every number defensively (Number.isFinite).
 */
export function toModel(read: (key: string) => unknown, history: (key: string) => Record<string, unknown>): ConditionsModel {
  return {
    radarFrames: objects(read('radarFrames')) as RadarFrame[],
    riverGauges: objects(read('riverGauges')) as RiverGauge[],
    riverHistory: history('riverHistory') as GaugeHistory<RiverSample>,
    riverUpdated: time(read('riverUpdated')),
    riverError: text(read('riverError')),
    rainGauges: objects(read('rainGauges')) as RainGauge[],
    rainHistory: history('rainHistory') as GaugeHistory<RainSample>,
    rainUpdated: time(read('rainUpdated')),
    rainError: text(read('rainError')),
    fireDanger: isObject(read('fireDanger')) ? read('fireDanger') as FireDangerReport : null,
    fireDangerUpdated: time(read('fireDangerUpdated')),
    fireDangerError: text(read('fireDangerError')),
    incidents: objects(read('incidents')) as FireIncident[],
    incidentsUpdated: time(read('incidentsUpdated')),
    incidentsError: text(read('incidentsError')),
    lastFetchAttempt: time(read('lastFetchAttempt')),
  };
}
