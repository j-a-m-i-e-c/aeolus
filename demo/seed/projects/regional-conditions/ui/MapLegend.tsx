import { FIRE, RAIN_BINS, RAIN_DRY, RAIN_STALE, RIVER, FireGlyph, RainGlyph, RiverGlyph } from './markers';

// The legend draws the same glyphs the map does, so a symbol on the map can be matched
// to its meaning by eye. A layer that is switched off is dimmed rather than removed, so
// the legend does not jump around as layers are toggled.

const caption = { color: '#A2B6C1', fontSize: 11, lineHeight: 1.4 };
const title = { color: '#DCE9EF', fontSize: 12, fontWeight: 700, marginBottom: 6 };

function Swatch({ children, label }: { children: any; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 12, marginBottom: 4 }}>
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
    <span style={caption}>{label}</span>
  </span>;
}

type Props = { layers: { river: boolean; rain: boolean; fires: boolean } };

export default function MapLegend({ layers }: Props) {
  const dim = (on: boolean) => ({ opacity: on ? 1 : 0.4, marginTop: 10 });
  return <div role="group" aria-label="Map legend">
    <div style={dim(layers.river)}>
      <div style={title}>River gauges · number is height (m), circle colour shows 1-hour trend</div>
      <Swatch label="rising"><RiverGlyph x={12} y={12} r={8} fill={RIVER.rising} /></Swatch>
      <Swatch label="steady"><RiverGlyph x={12} y={12} r={8} fill={RIVER.steady} /></Swatch>
      <Swatch label="falling"><RiverGlyph x={12} y={12} r={8} fill={RIVER.falling} /></Swatch>
      <Swatch label="stale (over 3 h old)"><RiverGlyph x={12} y={12} r={8} fill={RIVER.stale} /></Swatch>
      <Swatch label="reading flagged suspect"><RiverGlyph x={12} y={12} r={8} fill={RIVER.steady} suspect /></Swatch>
    </div>
    <div style={dim(layers.rain)}>
      <div style={title}>Rain gauges · raindrop, coloured by rain in the latest complete hour</div>
      {[...RAIN_BINS].reverse().map((bin) =>
        <Swatch key={bin.label} label={bin.label}><RainGlyph x={12} y={13} size={10} fill={bin.colour} stroke="#EDE6FB" /></Swatch>)}
      <Swatch label="dry"><RainGlyph x={12} y={13} size={10} fill="none" stroke={RAIN_DRY} /></Swatch>
      <Swatch label="no recent report"><RainGlyph x={12} y={13} size={10} fill="none" stroke={RAIN_STALE} dashed /></Swatch>
    </div>
    <div style={dim(layers.fires)}>
      <div style={title}>RFS incidents · flame, coloured by alert level</div>
      <Swatch label="Advice"><FireGlyph x={12} y={12} r={10} colour={FIRE.advice} /></Swatch>
      <Swatch label="Watch and Act"><FireGlyph x={12} y={12} r={10} colour={FIRE.watchAndAct} /></Swatch>
      <Swatch label="Emergency Warning"><FireGlyph x={12} y={12} r={10} colour={FIRE.emergency} /></Swatch>
    </div>
    <div style={{ ...caption, marginTop: 8 }}>Where a rain gauge shares a site with a river gauge, the raindrop sits just above and to the right of the circle.</div>
  </div>;
}
