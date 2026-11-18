import { RAIN_CURRENT_MS, RIVER_CURRENT_MS, TONE, ago, clock, freshness, trendOf } from './freshness';
import { RIVER, fireColour, rainColour } from './markers';
import type { Selection } from './RegionalMap';

const caption = { color: '#A2B6C1', fontSize: 12, lineHeight: 1.55 };
const big = { fontSize: 28, fontWeight: 800, marginTop: 6 };

function FreshnessLine({ observedAt, now, limit, quality, note }: { observedAt: unknown; now: number; limit: number; quality?: string | null; note?: string }) {
  const fresh = freshness(observedAt, now, limit);
  return <div style={caption}>
    <span style={{ color: fresh === 'current' ? TONE.good : TONE.warn, fontWeight: 700 }}>{fresh === 'current' ? 'Current' : 'Stale'}</span>
    {' · observed '}{clock(observedAt)}{' ('}{ago(observedAt, now)}{')'}
    {quality && <div style={{ color: quality === 'suspect' ? TONE.warn : '#A2B6C1' }}>
      {quality === 'suspect' ? 'Reading flagged suspect: ' : quality === 'checked' ? 'Passed WaterNSW checks: ' : 'Not yet quality coded: '}{note}
    </div>}
  </div>;
}

/** The retained readings as a line. Suspect samples are drawn as hollow points, not removed. */
function LevelHistory({ samples }: { samples: any[] }) {
  const data = samples.filter((s) => Number.isFinite(s?.t) && Number.isFinite(s?.v));
  if (data.length < 2) return <div style={caption}>Aeolus has kept {data.length} reading{data.length === 1 ? '' : 's'} so far. A history line appears from the second.</div>;
  const values = data.map((s) => Number(s.v));
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 0.05) { max += 0.025; min -= 0.025; }
  const t0 = data[0].t, span = Math.max(1, data[data.length - 1].t - t0);
  const pt = (s: any) => ({ x: 12 + (s.t - t0) / span * 276, y: 78 - (Number(s.v) - min) / (max - min) * 64 });
  const path = data.map((s, i) => { const p = pt(s); return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
  const delta = values[values.length - 1] - values[0];
  return <div>
    <svg viewBox="0 0 300 95" style={{ width: '100%', height: 110 }} role="img" aria-label="River level readings retained by Aeolus">
      <path d={path} fill="none" stroke="#6CC5DD" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {data.filter((s) => s.suspect).map((s) => { const p = pt(s); return <circle key={s.t} cx={p.x} cy={p.y} r={3.5} fill="#0E1B24" stroke={TONE.warn} strokeWidth={1.5} />; })}
      <line x1={12} x2={288} y1={88} y2={88} stroke="#426070" strokeWidth={1} />
      <text x={13} y={10} fontSize={12} fill="#B2CFDC">{max.toFixed(2)} m</text>
      <text x={13} y={93} fontSize={12} fill="#B2CFDC">{min.toFixed(2)} m</text>
    </svg>
    <div style={caption}>{data.length} readings kept by Aeolus over {ago(t0, data[data.length - 1].t).replace(' ago', '')} · {delta >= 0 ? '+' : ''}{delta.toFixed(2)} m</div>
  </div>;
}

function RainHours({ hours }: { hours: any[] }) {
  const data = hours.filter((h) => Number.isFinite(h?.t) && Number.isFinite(h?.mm)).slice(-24);
  if (!data.length) return <div style={caption}>No complete hours retained yet.</div>;
  const peak = Math.max(1, ...data.map((h) => h.mm));
  const w = 276 / 24;
  return <div>
    <svg viewBox="0 0 300 80" style={{ width: '100%', height: 96 }} role="img" aria-label="Hourly rainfall totals retained by Aeolus">
      {data.map((h, i) => {
        const height = h.mm > 0 ? Math.max(2, h.mm / peak * 60) : 1;
        const x = 12 + (24 - data.length + i) * w;
        return <rect key={h.t} x={x + 1} y={68 - height} width={w - 2} height={height} fill={h.suspect ? TONE.warn : h.mm > 0 ? rainColour(h.mm) : '#2E4552'} />;
      })}
      <line x1={12} x2={288} y1={68} y2={68} stroke="#426070" strokeWidth={1} />
      <text x={13} y={10} fontSize={12} fill="#B2CFDC">{peak.toFixed(1)} mm/h</text>
      <text x={288} y={79} fontSize={12} fill="#B2CFDC" textAnchor="end">latest hour</text>
    </svg>
    <div style={caption}>{data.length} complete hour{data.length === 1 ? '' : 's'} kept by Aeolus{data.some((h) => h.suspect) ? ' · amber bars are quality flagged' : ''}</div>
  </div>;
}

type Props = { selected: Selection; gauges: any[]; rain: any[]; incidents: any[]; riverHistory: any; rainHistory: any; now: number };

export default function SelectionDetail({ selected, gauges, rain, incidents, riverHistory, rainHistory, now }: Props) {
  if (selected?.kind === 'river') {
    const gauge = gauges.find((g) => g.id === selected.id);
    if (gauge && Number.isFinite(Number(gauge.level))) {
      const trend = gauge.quality !== 'suspect' && freshness(gauge.observedAt, now, RIVER_CURRENT_MS) === 'current' ? trendOf(gauge.change1h) : null;
      return <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{gauge.name}</div>
        <div style={big}>{Number(gauge.level).toFixed(2)} <span style={{ fontSize: 14 }}>m gauge height</span></div>
        {trend && <div style={{ ...caption, color: RIVER[trend] }}>{trend === 'steady' ? 'Steady' : trend === 'rising' ? 'Rising' : 'Falling'} · {Number(gauge.change1h) >= 0 ? '+' : ''}{Number(gauge.change1h).toFixed(2)} m per hour</div>}
        <FreshnessLine observedAt={gauge.observedAt} now={now} limit={RIVER_CURRENT_MS} quality={gauge.quality} note={gauge.qualityNote} />
        <div style={{ marginTop: 10 }}><LevelHistory samples={Array.isArray(riverHistory?.[gauge.id]) ? riverHistory[gauge.id] : []} /></div>
        <div style={{ ...caption, marginTop: 8 }}>Height above this gauge's own datum. It is not a flood depth, cannot be compared between gauges, and is not a flood classification.</div>
      </div>;
    }
  }
  if (selected?.kind === 'rain') {
    const station = rain.find((s) => s.id === selected.id);
    if (station && Number.isFinite(Number(station.lastHourMm))) {
      return <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{station.name}</div>
        <div style={big}>{Number(station.lastHourMm).toFixed(1)} <span style={{ fontSize: 14 }}>mm in the latest complete hour</span></div>
        <div style={caption}>{Number(station.total24h).toFixed(1)} mm over the {station.hoursCovered} hour{station.hoursCovered === 1 ? '' : 's'} Aeolus has kept</div>
        <FreshnessLine observedAt={station.observedAt} now={now} limit={RAIN_CURRENT_MS} quality={station.suspect ? 'suspect' : undefined} note={station.suspect ? 'Latest hourly total flagged by WaterNSW' : undefined} />
        <div style={{ marginTop: 10 }}><RainHours hours={Array.isArray(rainHistory?.[station.id]) ? rainHistory[station.id] : []} /></div>
        <div style={{ ...caption, marginTop: 8 }}>Measured by a WaterNSW rain gauge. Not radar and not a forecast.</div>
      </div>;
    }
  }
  if (selected?.kind === 'fire') {
    const incident = incidents.find((i) => i.id === selected.id);
    if (incident) {
      return <div>
        <div style={{ fontSize: 16, fontWeight: 750 }}>{incident.title}</div>
        {incident.alert && <div style={{ ...caption, color: fireColour(incident.alert), fontWeight: 700, marginTop: 4 }}>{incident.alert}</div>}
        <div style={{ ...caption, marginTop: 6 }}>{[incident.type, incident.status, incident.size].filter(Boolean).join(' · ')}</div>
        <div style={caption}>{[incident.location, incident.council].filter(Boolean).join(' · ')}</div>
        {incident.agency && <div style={caption}>Responsible agency: {incident.agency}</div>}
        {incident.updated && <div style={caption}>RFS last updated: {incident.updated}</div>}
        <div style={{ ...caption, marginTop: 8 }}>Positions can be approximate. For official information see rfs.nsw.gov.au, Fires Near Me.</div>
      </div>;
    }
  }
  return <div style={caption}>Select a river gauge (circle), a rain gauge (raindrop) or an RFS incident (flame) on the map. River and rainfall history is what Aeolus has kept since it started reading these gauges.</div>;
}
