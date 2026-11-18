import { LAND } from './coastline';
import { LABELS as RIVER_LABELS, RIVERS } from './rivers';
import RadarLayer from './RadarLayer';
import { heightBadges } from './height-labels';
import { RAIN_CURRENT_MS, RIVER_CURRENT_MS, freshness, trendOf } from './freshness';
import { FireGlyph, RAIN_DRY, RAIN_STALE, RIVER, RainGlyph, RiverGlyph, fireColour, rainColour } from './markers';

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

const linePath = (points: [number, number][]) => points.map(([lon, lat], i) => {
  const c = project(lon, lat);
  return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1);
}).join(' ');
// Projected once: the geometry is fixed, and the map re-renders every radar frame.
const RIVER_PATHS = RIVERS.map((river) => ({ ...river, d: river.paths.map(linePath).join(' ') }));
const RIVER_LABEL_POINTS = RIVER_LABELS.map((label) => ({ name: label.name, ...project(label.lon, label.lat) }));

export type Selection = { kind: 'river' | 'rain' | 'fire'; id: string } | null;
type Layers = { river: boolean; rain: boolean; fires: boolean; radar: boolean; heights: boolean };

type Props = {
  gauges: any[]; rain: any[]; incidents: any[]; now: number; layers: Layers;
  selected: Selection; onSelect: (selection: Selection) => void;
  radarFrame?: { capturedAt: number; grid: string; palette: string[]; size: number; bounds: number[] };
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
// circle covers the raindrop and swallows its clicks, so a co-located raindrop sits up
// and to the right of the river gauge instead. The offset is drawing only.
const BADGE_OFFSET = { x: 14, y: -14 };

function drawable(gauge: any, now: number) {
  return onMap(gauge.lon, gauge.lat) && Number.isFinite(Number(gauge.level))
    && freshness(gauge.observedAt, now, RIVER_CURRENT_MS) !== 'unavailable';
}

/** A short line on the map itself when a layer is on but has nothing to draw. */
function emptyNotes(layers: Layers, riverCount: number, rainCount: number, fireCount: number) {
  const notes: string[] = [];
  if (layers.river && riverCount === 0) notes.push('River gauges: no readings to show');
  if (layers.rain && rainCount === 0) notes.push('Rain gauges: no readings to show');
  if (layers.fires && fireCount === 0) notes.push('RFS: no incidents reported in this area');
  return notes;
}

export default function RegionalMap({ gauges, rain, incidents, now, layers, selected, onSelect, radarFrame }: Props) {
  const isChosen = (kind: string, id: string) => selected?.kind === kind && selected.id === id;
  const riverDrawn = new Set(layers.river ? gauges.filter((g) => drawable(g, now)).map((g) => g.id) : []);
  const rainShown = rain.filter((s) => onMap(s.lon, s.lat) && freshness(s.observedAt, now, RAIN_CURRENT_MS) !== 'unavailable');
  const firesShown = incidents.filter((i) => onMap(i.lon, i.lat));
  const notes = emptyNotes(layers, riverDrawn.size, rainShown.length, firesShown.length);
  const numericBadges = layers.river && layers.heights
    ? heightBadges(gauges.filter((g) => riverDrawn.has(g.id)), project, WIDTH, HEIGHT,
      selected?.kind === 'river' ? selected.id : undefined) : [];

  return <svg role="img" aria-label="Northern Rivers map with the main rivers, measured river heights, measured rainfall and RFS incidents"
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block', width: '100%', height: 'auto', background: '#0A2430', borderRadius: 10 }}>
    <path d={LAND_PATH} fill="#17342D" stroke="#4C796D" strokeWidth={1.6} fillRule="evenodd" />
    {layers.radar && <RadarLayer frame={radarFrame} project={project} />}
    {/* Rivers above radar, so heavy rain cannot hide them, and under every marker.
        They take no clicks. */}
    <g pointerEvents="none" aria-hidden="true">
      {RIVER_PATHS.map((river) => <path key={river.name} d={river.d} fill="none" stroke="#4FA3C7"
        strokeOpacity={river.main ? 0.8 : 0.5} strokeWidth={river.main ? 2.2 : 1.3} strokeLinecap="round" strokeLinejoin="round" />)}
    </g>
    {[152.5, 153, 153.5, 154].map((lon) => <line key={'lon' + lon} x1={project(lon, 0).x} x2={project(lon, 0).x} y1={0} y2={HEIGHT} stroke="#B3C4D0" strokeOpacity={0.08} strokeDasharray="4 8" />)}
    {[-28, -28.5, -29, -29.5, -30].map((lat) => <line key={'lat' + lat} x1={0} x2={WIDTH} y1={project(0, lat).y} y2={project(0, lat).y} stroke="#B3C4D0" strokeOpacity={0.08} strokeDasharray="4 8" />)}

    {layers.river && gauges.map((gauge: any) => {
      if (!riverDrawn.has(gauge.id)) return null;
      const fresh = freshness(gauge.observedAt, now, RIVER_CURRENT_MS);
      const c = project(gauge.lon, gauge.lat);
      const trend = fresh === 'current' && gauge.quality !== 'suspect' ? trendOf(gauge.change1h) : null;
      const fill = fresh === 'stale' ? RIVER.stale : trend ? RIVER[trend] : RIVER.steady;
      const label = `River gauge, ${gauge.name}: ${Number(gauge.level).toFixed(2)} m${fresh === 'stale' ? ', stale' : ''}${gauge.quality === 'suspect' ? ', reading flagged suspect' : trend ? ', ' + trend : ''}`;
      return <Marker key={'river' + gauge.id} x={c.x} y={c.y} label={label} chosen={isChosen('river', gauge.id)} onPick={() => onSelect({ kind: 'river', id: gauge.id })}>
        <RiverGlyph x={c.x} y={c.y} fill={fill} suspect={gauge.quality === 'suspect'} />
      </Marker>;
    })}

    {layers.rain && rainShown.map((station: any) => {
      const fresh = freshness(station.observedAt, now, RAIN_CURRENT_MS);
      const site = project(station.lon, station.lat);
      const c = riverDrawn.has(station.id) ? { x: site.x + BADGE_OFFSET.x, y: site.y + BADGE_OFFSET.y } : site;
      const mm = Number(station.lastHourMm) || 0;
      const wet = fresh === 'current' && mm > 0;
      const label = `Rain gauge, ${station.name}: ${fresh === 'current' ? mm.toFixed(1) + ' mm in the latest complete hour' : 'no recent rainfall report'}`;
      return <Marker key={'rain' + station.id} x={c.x} y={c.y} label={label} chosen={isChosen('rain', station.id)} onPick={() => onSelect({ kind: 'rain', id: station.id })}>
        <RainGlyph x={c.x} y={c.y} size={wet ? 11 + Math.min(5, mm / 4) : 10}
          fill={wet ? rainColour(mm) : 'none'} stroke={fresh === 'stale' ? RAIN_STALE : wet ? '#EDE6FB' : RAIN_DRY} dashed={fresh === 'stale'} />
      </Marker>;
    })}

    {/* Gauge badges show ACTUAL metres at each station, in addition to the trend
        encoded by the circle colour. Selected details retain the exact reading,
        24-hour graph and datum warning. Collision handling avoids marker crowding. */}
    {numericBadges.map((badge) => <g key={'height' + badge.id} pointerEvents="none">
      <rect x={badge.x} y={badge.y} width={54} height={21} rx={5} fill="#071821" fillOpacity={0.92}
        stroke={selected?.kind === 'river' && selected.id === badge.id ? '#FFFFFF' : '#547788'} strokeWidth={1} />
      <text x={badge.x + 27} y={badge.y + 14.5} textAnchor="middle" fontSize={12}
        fontWeight={700} fill="#E5F2FA">{badge.text}</text>
    </g>)}

    {layers.fires && firesShown.map((incident: any, i: number) => {
      const c = project(incident.lon, incident.lat);
      return <Marker key={'fire' + (incident.id || i)} x={c.x} y={c.y} label={`RFS incident ${incident.title}${incident.alert ? ', ' + incident.alert : ''}`}
        chosen={isChosen('fire', incident.id)} onPick={() => onSelect({ kind: 'fire', id: incident.id })}>
        <FireGlyph x={c.x} y={c.y} colour={fireColour(incident.alert)} />
      </Marker>;
    })}

    {/* River names, italic and blue so they read as water rather than places. */}
    {RIVER_LABEL_POINTS.map((label) => <text key={'rl' + label.name} x={label.x + 4} y={label.y - 3} pointerEvents="none"
      fontSize={12} fontStyle="italic" fill="#8FCBE3" stroke="#071821" strokeWidth={3} paintOrder="stroke">{label.name}</text>)}

    {/* Town labels are not interactive. */}
    {TOWNS.map(([name, lon, lat]) => {
      const c = project(lon, lat);
      return <g key={name} pointerEvents="none">
        <circle cx={c.x} cy={c.y} r={2.5} fill="#D3E4E9" opacity={0.6} />
        <text x={c.x + 6} y={c.y - 6} fontSize={13} fill="#C1D4DB" stroke="#071821" strokeWidth={3} paintOrder="stroke">{name}</text>
      </g>;
    })}

    {notes.map((note, i) => <g key={note} pointerEvents="none">
      <rect x={14} y={14 + i * 30} width={note.length * 7.4 + 20} height={24} rx={6} fill="#071821" fillOpacity={0.82} stroke="#2F4A58" />
      <text x={24} y={31 + i * 30} fontSize={13} fill="#C9DCE4">{note}</text>
    </g>)}

    <text x={18} y={HEIGHT - 16} fill="#B5CAD3" fontSize={13}>NORTHERN RIVERS · NSW</text>
    <text x={WIDTH - 18} y={HEIGHT - 16} textAnchor="end" fill="#B5CAD3" fontSize={13}>North ↑</text>
  </svg>;
}
