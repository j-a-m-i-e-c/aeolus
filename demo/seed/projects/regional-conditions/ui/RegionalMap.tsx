import { LAND } from './coastline';
import { RAIN_CURRENT_MS, RIVER_CURRENT_MS, TONE, fireColour, freshness, rainColour, trendOf } from './freshness';

// Drawn entirely in SVG from coordinates: no tiles, iframes, images or external scripts.
// Equirectangular, with longitude scaled by cos(latitude) at the frame's centre so the
// region keeps its true shape instead of being stretched sideways.
const BOUNDS = { west: 152, east: 154.2, south: -30.2, north: -27.7 };
const LON_SCALE = Math.cos(((BOUNDS.north + BOUNDS.south) / 2) * Math.PI / 180);
const WIDTH = 800;
const HEIGHT = Math.round(WIDTH * (BOUNDS.north - BOUNDS.south) / ((BOUNDS.east - BOUNDS.west) * LON_SCALE));

function project(lon: number, lat: number) {
  return {
    x: (lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * WIDTH,
    y: (BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south) * HEIGHT,
  };
}
function onMap(lon: unknown, lat: unknown) {
  const x = Number(lon), y = Number(lat);
  return lon !== null && lat !== null && Number.isFinite(x) && Number.isFinite(y)
    && x >= BOUNDS.west && x <= BOUNDS.east && y >= BOUNDS.south && y <= BOUNDS.north;
}

const TOWNS: [string, number, number][] = [
  ['Tweed Heads', 153.54, -28.18], ['Murwillumbah', 153.40, -28.33], ['Byron Bay', 153.61, -28.65],
  ['Lismore', 153.28, -28.81], ['Ballina', 153.56, -28.87], ['Casino', 153.05, -28.86],
  ['Kyogle', 153.00, -28.62], ['Yamba', 153.36, -29.44], ['Grafton', 152.94, -29.69],
];

const LAND_PATH = LAND.map((ring) => ring.map(([lon, lat], i) => {
  const c = project(lon, lat);
  return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1);
}).join(' ') + ' Z').join(' ');

export type Selection = { kind: 'river' | 'rain' | 'fire'; id: string } | null;
type Layers = { river: boolean; rain: boolean; fires: boolean };

type Props = {
  gauges: any[]; rain: any[]; incidents: any[]; now: number; layers: Layers;
  selected: Selection; onSelect: (selection: Selection) => void;
};

function Marker({ x, y, label, chosen, onPick, children }: { x: number; y: number; label: string; chosen: boolean; onPick: () => void; children: any }) {
  return <g className="regional-marker" role="button" tabIndex={0} aria-label={label} aria-pressed={chosen} style={{ cursor: 'pointer' }}
    onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}>
    {chosen && <circle cx={x} cy={y} r={17} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.85} />}
    {children}
    <title>{label}</title>
  </g>;
}

// Most rain gauges share a site with a river gauge. Drawn at the same point the river
// circle covers the rain marker and swallows its clicks, so a co-located rain marker sits
// as a badge up and to the right of the river gauge instead. The offset is drawing only.
const BADGE_OFFSET = { x: 13, y: -13 };

function drawable(gauge: any, now: number) {
  return onMap(gauge.lon, gauge.lat) && Number.isFinite(Number(gauge.level))
    && freshness(gauge.observedAt, now, RIVER_CURRENT_MS) !== 'unavailable';
}

export default function RegionalMap({ gauges, rain, incidents, now, layers, selected, onSelect }: Props) {
  const isChosen = (kind: string, id: string) => selected?.kind === kind && selected.id === id;
  const riverDrawn = new Set(layers.river ? gauges.filter((g) => drawable(g, now)).map((g) => g.id) : []);
  return <svg role="img" aria-label="Northern Rivers map with measured river heights, measured rainfall and RFS incidents"
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block', width: '100%', height: 'auto', background: '#0A2430', borderRadius: 10 }}>
    <path d={LAND_PATH} fill="#17342D" stroke="#4C796D" strokeWidth={1.6} fillRule="evenodd" />
    {[152.5, 153, 153.5, 154].map((lon) => <line key={'lon' + lon} x1={project(lon, 0).x} x2={project(lon, 0).x} y1={0} y2={HEIGHT} stroke="#B3C4D0" strokeOpacity={0.08} strokeDasharray="4 8" />)}
    {[-28, -28.5, -29, -29.5, -30].map((lat) => <line key={'lat' + lat} x1={0} x2={WIDTH} y1={project(0, lat).y} y2={project(0, lat).y} stroke="#B3C4D0" strokeOpacity={0.08} strokeDasharray="4 8" />)}

    {layers.river && gauges.map((gauge: any) => {
      if (!riverDrawn.has(gauge.id)) return null;
      const fresh = freshness(gauge.observedAt, now, RIVER_CURRENT_MS);
      const c = project(gauge.lon, gauge.lat);
      const trend = fresh === 'current' && gauge.quality !== 'suspect' ? trendOf(gauge.change1h) : null;
      const fill = fresh === 'stale' ? TONE.stale : trend ? TONE[trend] : TONE.steady;
      const label = `${gauge.name}: ${Number(gauge.level).toFixed(2)} m${fresh === 'stale' ? ', stale' : ''}${gauge.quality === 'suspect' ? ', reading flagged suspect' : trend ? ', ' + trend : ''}`;
      return <Marker key={'river' + gauge.id} x={c.x} y={c.y} label={label} chosen={isChosen('river', gauge.id)} onPick={() => onSelect({ kind: 'river', id: gauge.id })}>
        <circle cx={c.x} cy={c.y} r={9} fill={fill} stroke={gauge.quality === 'suspect' ? TONE.warn : '#B6F3FF'}
          strokeWidth={gauge.quality === 'suspect' ? 2.5 : 1.4} strokeDasharray={gauge.quality === 'suspect' ? '3 2' : undefined} />
        <circle cx={c.x} cy={c.y} r={2.5} fill="#E3FBFF" />
      </Marker>;
    })}

    {layers.rain && rain.map((station: any) => {
      if (!onMap(station.lon, station.lat)) return null;
      const fresh = freshness(station.observedAt, now, RAIN_CURRENT_MS);
      if (fresh === 'unavailable') return null;
      const site = project(station.lon, station.lat);
      const c = riverDrawn.has(station.id) ? { x: site.x + BADGE_OFFSET.x, y: site.y + BADGE_OFFSET.y } : site;
      const mm = Number(station.lastHourMm) || 0;
      const wet = fresh === 'current' && mm > 0;
      const side = wet ? 10 + Math.min(10, mm) : 9;
      const label = `${station.name}: ${fresh === 'current' ? mm.toFixed(1) + ' mm in the last reported hour' : 'no recent rainfall report'}`;
      return <Marker key={'rain' + station.id} x={c.x} y={c.y} label={label} chosen={isChosen('rain', station.id)} onPick={() => onSelect({ kind: 'rain', id: station.id })}>
        <rect x={c.x - side / 2} y={c.y - side / 2} width={side} height={side} rx={2} transform={`rotate(45 ${c.x} ${c.y})`}
          fill={wet ? rainColour(mm) : 'none'} stroke={fresh === 'current' ? '#9BE3D6' : TONE.stale} strokeWidth={1.6}
          strokeDasharray={fresh === 'stale' ? '3 2' : undefined} />
      </Marker>;
    })}

    {layers.fires && incidents.map((incident: any, i: number) => {
      if (!onMap(incident.lon, incident.lat)) return null;
      const c = project(incident.lon, incident.lat);
      const colour = fireColour(incident.alert);
      return <Marker key={'fire' + (incident.id || i)} x={c.x} y={c.y} label={`RFS incident ${incident.title}${incident.alert ? ', ' + incident.alert : ''}`}
        chosen={isChosen('fire', incident.id)} onPick={() => onSelect({ kind: 'fire', id: incident.id })}>
        <circle cx={c.x} cy={c.y} r={12} fill="#0F1A20" stroke={colour} strokeWidth={2.2} />
        <path d={`M${c.x},${c.y - 7} Q${c.x - 8},${c.y + 2} ${c.x},${c.y + 8} Q${c.x + 8},${c.y + 2} ${c.x},${c.y - 7}`} fill={colour} />
      </Marker>;
    })}

    {/* Towns last, so a marker never hides a name. They take no clicks. */}
    {TOWNS.map(([name, lon, lat]) => {
      const c = project(lon, lat);
      return <g key={name} pointerEvents="none">
        <circle cx={c.x} cy={c.y} r={2.5} fill="#D3E4E9" opacity={0.6} />
        <text x={c.x + 6} y={c.y - 6} fontSize={13} fill="#C1D4DB" stroke="#071821" strokeWidth={3} paintOrder="stroke">{name}</text>
      </g>;
    })}

    <text x={18} y={HEIGHT - 16} fill="#B5CAD3" fontSize={13}>NORTHERN RIVERS · NSW</text>
    <text x={WIDTH - 18} y={HEIGHT - 16} textAnchor="end" fill="#B5CAD3" fontSize={13}>North ↑</text>
  </svg>;
}
