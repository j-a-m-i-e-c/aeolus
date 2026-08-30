interface Props {
  dam: number;
  header: number;
  shed: number;
  house: number;
  moving: boolean;
  pumpOn: boolean;
  shedRefill: boolean;
  houseRefill: boolean;
  phase: number;
}

function Tank(props: { x: number; y: number; w: number; h: number; label: string; value: number; litresPerPct: number; accent?: string }) {
  const fill = Math.max(5, (props.h - 10) * props.value / 100);
  const accent = props.accent || "#42C9EA";
  return <g transform={`translate(${props.x} ${props.y})`}>
    <rect width={props.w} height={props.h} rx="10" fill="#0A171A" stroke="#405E64" strokeWidth="1.2" />
    <rect x="5" y={props.h - 5 - fill} width={props.w - 10} height={fill} rx="6" fill={accent} opacity=".58" />
    <line x1="7" x2={props.w - 7} y1={props.h * .35} y2={props.h * .35} stroke="#6A8388" strokeOpacity=".22" strokeDasharray="3 4" />
    <text x={props.w / 2} y="-7" textAnchor="middle" fill="#7C9297" fontSize="10" letterSpacing="1">{props.label}</text>
    <text x={props.w / 2} y={props.h / 2 + 4} textAnchor="middle" fill="#E9FAFE" fontSize={props.w > 75 ? "18" : "13"} fontFamily="monospace" fontWeight="800">{Math.round(props.value)}%</text>
    <text x={props.w / 2} y={props.h / 2 + 18} textAnchor="middle" fill="#68878E" fontSize="10">{Math.round(props.value * props.litresPerPct).toLocaleString()} L</text>
  </g>;
}

function PulseLine({ path, active, phase, color = "#4BD9F6" }: { path: string; active: boolean; phase: number; color?: string }) {
  return <g>
    <path d={path} fill="none" stroke="#243A3F" strokeWidth="7" strokeLinecap="round" />
    <path d={path} fill="none" stroke={active ? color : "#40585D"} strokeWidth="2.2" strokeLinecap="round" />
    {active && Array.from({ length: 5 }).map((_, i) => {
      const offset = ((phase * 4 + i * 19) % 100);
      return <path key={i} d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 99" strokeDashoffset={-offset} opacity=".9" />;
    })}
  </g>;
}

export function WaterSchematic({ dam, header, shed, house, moving, pumpOn, shedRefill, houseRefill, phase }: Props) {
  return (
    <div style={{ border: "1px solid #243B40", borderRadius: 12, overflow: "hidden", background: "#071114" }}>
      <svg width="100%" height="278" viewBox="0 0 620 278" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="water-ground" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0D211B"/><stop offset="1" stopColor="#10271F"/></linearGradient>
          <filter id="water-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width="620" height="278" fill="#071114" />
        <path d="M0 208 C120 170 214 180 300 142 C390 103 485 116 620 86 L620 278 L0 278 Z" fill="url(#water-ground)" />

        <Tank x={30} y={156} w={128} h={82} label="LOWER DAM" value={dam} litresPerPct={600} accent="#268FB3" />
        <PulseLine path="M158 199 C215 194 236 169 276 126 C310 90 345 82 386 82" active={moving} phase={phase} />
        <g transform="translate(220 174)">
          <circle r="23" fill="#09181B" stroke={pumpOn ? "#51D5F5" : "#3D5358"} strokeWidth="2" />
          <g style={{ transform: `rotate(${moving ? phase * 10 : 0}deg)`, transformOrigin: "0px 0px" }}><path d="M0 -12 L4 -3 L12 0 L4 3 L0 12 L-4 3 L-12 0 L-4 -3 Z" fill={pumpOn ? "#70E2F7" : "#52666B"}/></g>
          <text x="0" y="36" textAnchor="middle" fill="#70868A" fontSize="10">TRANSFER</text>
        </g>

        <Tank x={366} y={38} w={102} h={128} label="HEADER" value={header} litresPerPct={50} accent="#38BFE4" />
        <PulseLine path="M417 166 C432 190 470 192 495 201" active={shedRefill} phase={phase} color="#66DCF5" />
        <PulseLine path="M417 166 C455 179 536 169 563 184" active={houseRefill} phase={phase} color="#66DCF5" />
        <Tank x={470} y={190} w={62} h={62} label="SHED" value={shed} litresPerPct={80} accent="#318CAC" />
        <Tank x={544} y={176} w={62} h={76} label="HOUSE" value={house} litresPerPct={40} accent="#318CAC" />

        <g transform="translate(483 170)"><circle r="7" fill={shedRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>
        <g transform="translate(551 158)"><circle r="7" fill={houseRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>

        {moving && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={178 + ((phase * 3 + i * 39) % 185)} cy={190 - ((phase * 3 + i * 39) % 185) * .48} r="2.1" fill="#9AF0FF" opacity=".9" filter="url(#water-glow)" />)}

        <text x="309" y="269" textAnchor="middle" fill="#50666B" fontSize="10">Header gravity feeds local storage · each refill is verified against the destination tank sensor</text>
      </svg>
    </div>
  );
}
