import { useEffect, useState } from 'react';
import { control } from "@aeolus/ui";
import RegionalMap, { type Selection } from './RegionalMap';
import SelectionDetail from './SelectionDetail';
import MapLegend from './MapLegend';
import { RAIN_CURRENT_MS, REFRESH_FLOOR_MS, RIVER_CURRENT_MS, TONE, ago, freshness, sourceStatus } from './freshness';

import type { ConditionsModel } from "./model";
const root = { minHeight: '100%', padding: 16, background: '#081119', color: '#E7F0F5', fontFamily: 'inherit' };
const panel = { background: '#0E1B24', border: '1px solid #284150', borderRadius: 12, padding: 14, minWidth: 0 };
const caption = { color: '#A2B6C1', fontSize: 12, lineHeight: 1.55 };
const heading = { fontWeight: 750, fontSize: 13, letterSpacing: '.03em', marginBottom: 10 };
// Expected gap between successful refreshes before a source is called overdue: the
// maximum source refresh interval plus slack for a missed run.
const REFRESH_EXPECT_MS = 25 * 60 * 1000;

function count(items: { observedAt: number | null }[], limit: number, now: number) {
  const tally = { current: 0, stale: 0, unavailable: 0 };
  for (const item of items) tally[freshness(item.observedAt, now, limit)]++;
  return tally;
}

function Source({ name, updated, error, now }: { name: string; updated: unknown; error: unknown; now: number }) {
  const status = sourceStatus(updated, error, now, REFRESH_EXPECT_MS);
  return <div style={{ marginTop: 8 }}>
    <div style={{ fontSize: 12, color: '#D4E5EB' }}>{name}</div>
    <div style={{ ...caption, color: status.tone }}>{status.label}</div>
  </div>;
}

/**
 * Refresh with visible state. Pressing it marks it "Refreshing…" until the Logic records
 * a new attempt (or 30 s pass). Within the Logic's refresh floor it is disabled and says
 * when it can be used again, rather than accepting a press that will be ignored.
 */
function RefreshButton({ lastAttempt, now, onRefresh }: { lastAttempt: unknown; now: number; onRefresh: () => void }) {
  const last = Number(lastAttempt) || 0;
  const [request, setRequest] = useState<{ at: number; lastSeen: number } | null>(null);
  const [, setTick] = useState(0);
  const pending = request !== null && request.lastSeen === last && Date.now() - request.at < 30000;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setTick((t) => t + 1), 30000);
    return () => clearTimeout(timer);
  }, [pending]);
  const wait = last > 0 ? last + REFRESH_FLOOR_MS - now : 0;
  // The kit supplies the disabled and pending look, cursor and aria state, so a
  // refresh that cannot run yet looks unavailable rather than merely unresponsive.
  const visual = control({ pending, disabled: wait > 0 });
  const label = pending ? 'Fetching river, rain and fire data…'
    : wait > 0 ? `Checked ${ago(last, now)} · again in ${Math.ceil(wait / 60000)} min` : 'Refresh sources';
  return <button type="button" {...visual} style={{ ...visual.style, padding: '8px 12px', borderRadius: 8, fontSize: 12 }}
    onClick={() => { setRequest({ at: Date.now(), lastSeen: last }); onRefresh(); }}>
    {label}
  </button>;
}

function dangerTone(rating: string) {
  const r = rating.toLowerCase();
  return r.includes('catastrophic') ? '#F2D4E9' : r.includes('extreme') ? '#F08A94' : r.includes('high') ? '#E8B772' : r.includes('moderate') ? '#9FD49A' : '#A6B9C3';
}

function FireDanger({ model, now }: { model: ConditionsModel; now: number }) {
  const danger = model.fireDanger;
  if (!danger) return <div style={caption}>Waiting for the NSW RFS fire danger feed.</div>;
  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {([['Today', danger.today, danger.fireBanToday], ['Tomorrow', danger.tomorrow, danger.fireBanTomorrow]] as const).map(([label, rating, ban]) =>
        <div key={label} style={{ background: '#0A1921', padding: 10, borderRadius: 8, minWidth: 0 }}>
          <div style={caption}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 850, color: dangerTone(String(rating)), margin: '6px 0' }}>{String(rating)}</div>
          <div style={{ ...caption, color: ban === true ? '#F0A88D' : '#A6B9C3' }}>{ban === true ? 'TOTAL FIRE BAN' : ban === false ? 'No total fire ban' : 'Ban status not given'}</div>
        </div>)}
    </div>
    <Source name="NSW RFS fire danger" updated={model.fireDangerUpdated} error={model.fireDangerError} now={now} />
  </div>;
}

export default function RegionalConditionsDashboard({ model, actions }: { model: ConditionsModel; actions: { refresh: () => void } }) {
  const [now, setNow] = useState(Date.now());
  const [layers, setLayers] = useState({ river: true, rain: true, fires: true, radar: true, heights: true });
  const [frameIndex, setFrameIndex] = useState(0);
  const [selected, setSelected] = useState<Selection>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);

  const retainedFrames = model.radarFrames.filter((f) => f && f.size === 80 && typeof f.grid === 'string');
  // A disconnected collector must never leave yesterday's radar animating as current.
  const frames = retainedFrames.filter((f) => Number.isFinite(f.capturedAt) && f.capturedAt <= now + 5 * 60000 && now - f.capturedAt <= 2 * 3600 * 1000);
  useEffect(() => {
    if (frames.length <= 1 || !layers.radar) return;
    const timer = setInterval(() => setFrameIndex((i) => i + 1), 800);
    return () => clearInterval(timer);
  }, [frames.length, layers.radar]);
  const radarFrame = frames.length ? frames[frameIndex % frames.length] : undefined;
  const gauges = model.riverGauges;
  const rain = model.rainGauges;
  const incidents = model.incidents;
  const unmapped = incidents.filter((i) => i.lon === null || i.lat === null);
  const river = count(gauges, RIVER_CURRENT_MS, now);
  const rainTally = count(rain, RAIN_CURRENT_MS, now);
  const wet = rain.filter((s) => freshness(s.observedAt, now, RAIN_CURRENT_MS) === 'current' && Number(s.lastHourMm) > 0).length;

  return <div style={root}>
    {/* A mouse click selects a marker and draws its white ring, so the browser's square
        focus box is suppressed for mouse focus only. Keyboard focus keeps an outline. */}
    <style>{'@media (max-width: 900px) { .regional-layout { grid-template-columns: minmax(0,1fr) !important; } }'
      + ' .regional-marker:focus:not(:focus-visible) { outline: none; }'
      + ' .regional-marker:focus-visible { outline: 2px solid #9CD7FD; outline-offset: 2px; }'}</style>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 9 }}>
          <strong style={{ fontSize: 22, letterSpacing: '.02em' }}>NORTHERN RIVERS CONDITIONS</strong>
          <span style={{ fontSize: 11, borderRadius: 12, color: TONE.good, border: '1px solid #316650', padding: '3px 9px' }}>LIVE PUBLIC SOURCES</span>
        </div>
        <div style={{ ...caption, marginTop: 4 }}>Current gauge heights (m), 1-hour trends and 24-hour history · RFS fires · RainViewer radar</div>
      </div>
      <RefreshButton lastAttempt={model.lastFetchAttempt} now={now} onRefresh={actions.refresh} />
    </header>

    <div className="regional-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(280px,1fr)', gap: 12 }}>
      <section style={{ ...panel, padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '2px 2px 10px' }}>
          {([['river', 'River gauges'], ['rain', 'Rainfall gauges'], ['fires', 'RFS incidents'], ['radar', 'Animated radar'], ['heights', 'Height labels (m)']] as const).map(([key, label]) =>
            <label key={key} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#D4E5EB' }}>
              <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((s) => ({ ...s, [key]: e.target.checked }))} />{label}
            </label>)}
        </div>
        <RegionalMap gauges={gauges} rain={rain} incidents={incidents} now={now} layers={layers} selected={selected} onSelect={setSelected} radarFrame={radarFrame} />
        <MapLegend layers={layers} />
        <div style={{ ...caption, marginTop: 6 }}>
          {frames.length ? `RainViewer radar · frame ${new Date(radarFrame.capturedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} · ${frames.length} frames`
            : retainedFrames.length ? 'Radar is stale. The collector has not supplied recent RainViewer frames.' : 'Radar is not connected on this installation.'}
        </div>
      </section>

      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <section style={panel}><div style={heading}>FAR NORTH COAST · FIRE DANGER</div><FireDanger model={model} now={now} /></section>
        <section style={panel}>
          <div style={heading}>{selected ? 'SELECTED' : 'MAP DETAIL'}</div>
          <SelectionDetail selected={selected} gauges={gauges} rain={rain} incidents={incidents} riverHistory={model.riverHistory} rainHistory={model.rainHistory} now={now} />
        </section>
        <section style={panel}>
          <div style={heading}>SOURCES</div>
          <div style={caption}>River heights: {river.current} current · {river.stale} stale · {river.unavailable} no reading</div>
          <div style={caption}>Rain gauges: {rainTally.current} current ({wet} wet) · {rainTally.stale} stale · {rainTally.unavailable} no reading</div>
          <div style={caption}>RFS incidents in the region: {incidents.length}{unmapped.length ? ` (${unmapped.length} without a position on this map)` : ''}</div>
          <Source name="WaterNSW river heights" updated={model.riverUpdated} error={model.riverError} now={now} />
          <Source name="WaterNSW rainfall" updated={model.rainUpdated} error={model.rainError} now={now} />
          <Source name="NSW RFS incidents" updated={model.incidentsUpdated} error={model.incidentsError} now={now} />
          {unmapped.slice(0, 5).map((item) => <button key={item.id} type="button" onClick={() => setSelected({ kind: 'fire', id: item.id })}
            style={{ display: 'block', textAlign: 'left', width: '100%', marginTop: 6, padding: '5px 8px', borderRadius: 5, border: '1px solid #36505F', background: '#10222B', color: '#CEE0E8', cursor: 'pointer', fontSize: 11 }}>{item.title}</button>)}
          <div style={{ ...caption, marginTop: 8 }}>Public sources are polled at most every 5 minutes. The radar device is checked every 2 minutes. A source that fails retains its last observations, marked by age. Radar is an informational overlay, not an emergency warning.</div>
        </section>
      </div>
    </div>

    <section style={{ ...panel, marginTop: 12 }}>
      <div style={heading}>OFFICIAL INFORMATION</div>
      <div style={caption}>This is a software demonstration, not a warning service. Flood and fire warnings come from the issuing agencies: NSW RFS Fires Near Me (rfs.nsw.gov.au), NSW SES and Hazards Near Me (hazardwatch.gov.au), and Bureau of Meteorology flood warnings (bom.gov.au).</div>
    </section>
    <footer style={{ ...caption, marginTop: 12 }}>River and rainfall data © State of New South Wales through WaterNSW. Fire data © State of New South Wales (NSW Rural Fire Service). Land outline: Natural Earth, public domain. Rivers: © Commonwealth of Australia (Geoscience Australia), CC BY 4.0. Radar data by RainViewer (rainviewer.com). Layers rendered by Aeolus.</footer>
  </div>;
}
