interface Props {
    source: number;
    header: number;
    office: number;
    house: number;
    moving: boolean;
    pumpOn: boolean;
    officeRefill: boolean;
    houseRefill: boolean;
    phase: number;
}
function Tank(props: {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    value: number;
    litresPerPct: number;
    accent?: string;
    sensorSide?: "left" | "right";
}) {
    const fill = Math.max(5, (props.h - 10) * props.value / 100);
    const accent = props.accent || "#42C9EA";
    const sensorX = props.sensorSide === "left" ? -10 : props.w + 10;
    const sensorAnchor = props.sensorSide === "left" ? "end" : "start";
    return <g transform={`translate(${props.x} ${props.y})`}>
    <rect width={props.w} height={props.h} rx="10" fill="#0A171A" stroke="#405E64" strokeWidth="1.2"/>
    <rect x="5" y={props.h - 5 - fill} width={props.w - 10} height={fill} rx="6" fill={accent} opacity=".58"/>
    <line x1="7" x2={props.w - 7} y1={props.h * .35} y2={props.h * .35} stroke="#6A8388" strokeOpacity=".22" strokeDasharray="3 4"/>
    <text x={props.w / 2} y="-7" textAnchor="middle" fill="#8FA4A9" fontSize="10" fontWeight="750" letterSpacing=".8">{props.label}</text>
    <text x={props.w / 2} y={props.h / 2 + 4} textAnchor="middle" fill="#E9FAFE" fontSize={props.w > 75 ? "18" : "13"} fontFamily="monospace" fontWeight="800">{Math.round(props.value)}%</text>
    <text x={props.w / 2} y={props.h / 2 + 18} textAnchor="middle" fill="#68878E" fontSize="10">{Math.round(props.value * props.litresPerPct).toLocaleString()} L</text>
    <g transform={`translate(${sensorX} ${props.h * .37})`}>
      <circle r="6" fill="#0B1D21" stroke="#76D9ED" strokeWidth="1.2"/>
      <circle r="2" fill="#88E9F8"/>
      <line x1={props.sensorSide === "left" ? 6 : -6} y1="0" x2={props.sensorSide === "left" ? 13 : -13} y2="0" stroke="#466D74" strokeWidth="1"/>
      <text x={props.sensorSide === "left" ? -9 : 9} y="-9" textAnchor={sensorAnchor} fill="#6E9198" fontSize="8" fontWeight="700">LEVEL SENSOR</text>
    </g>
  </g>;
}
function PulseLine({ path, active, phase, color = "#4BD9F6" }: {
    path: string;
    active: boolean;
    phase: number;
    color?: string;
}) {
    return <g>
    <path d={path} fill="none" stroke="#243A3F" strokeWidth="7" strokeLinecap="round"/>
    <path d={path} fill="none" stroke={active ? color : "#40585D"} strokeWidth="2.2" strokeLinecap="round"/>
    {active && Array.from({ length: 5 }).map((_, i) => {
            const offset = ((phase * 4 + i * 19) % 100);
            return <path key={i} d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray="1 99" strokeDashoffset={-offset} opacity=".9"/>;
        })}
  </g>;
}
export function WaterSchematic({ source, header, office, house, moving, pumpOn, officeRefill, houseRefill, phase }: Props) {
    return (<div style={{ border: "1px solid #2B4B52", borderRadius: 13, overflow: "hidden", background: "#071114", boxShadow: "inset 0 0 40px rgba(50,170,195,.035)" }}>
      <svg width="100%" height="304" viewBox="0 0 650 304" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="water-ground" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0D211B"/><stop offset="1" stopColor="#10271F"/></linearGradient>
          <filter id="water-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width="650" height="304" fill="#071114"/>
        <path d="M0 232 C120 194 214 203 304 163 C398 120 500 132 650 98 L650 304 L0 304 Z" fill="url(#water-ground)"/>

        <g transform="translate(18 18)"><rect width="188" height="36" rx="8" fill="#0B1A1D" stroke="#29464C"/><text x="12" y="15" fill="#769097" fontSize="9" fontWeight="800" letterSpacing=".9">RAINWATER SOURCE</text><text x="12" y="29" fill="#C9E4E9" fontSize="11">Large shed roof + catchment storage</text></g>

        <Tank x={32} y={174} w={142} h={86} label="SHED CATCHMENT" value={source} litresPerPct={600} accent="#268FB3" sensorSide="right"/>
        <PulseLine path="M174 217 C231 211 255 182 294 141 C328 105 361 95 402 95" active={moving} phase={phase}/>
        <g transform="translate(240 192)">
          <circle r="24" fill="#09181B" stroke={pumpOn ? "#51D5F5" : "#3D5358"} strokeWidth="2"/>
          <g style={{ transform: `rotate(${moving ? phase * 10 : 0}deg)`, transformOrigin: "0px 0px" }}><path d="M0 -12 L4 -3 L12 0 L4 3 L0 12 L-4 3 L-12 0 L-4 -3 Z" fill={pumpOn ? "#70E2F7" : "#52666B"}/></g>
          <text x="0" y="38" textAnchor="middle" fill="#70868A" fontSize="9" fontWeight="700">TRANSFER PUMP</text>
        </g>

        <Tank x={382} y={50} w={106} h={132} label="HEADER TANK" value={header} litresPerPct={50} accent="#38BFE4" sensorSide="right"/>
        <PulseLine path="M435 182 C452 209 491 210 522 226" active={officeRefill} phase={phase} color="#66DCF5"/>
        <PulseLine path="M435 182 C475 194 554 187 589 208" active={houseRefill} phase={phase} color="#66DCF5"/>
        <Tank x={495} y={216} w={66} h={66} label="OFFICE" value={office} litresPerPct={80} accent="#318CAC" sensorSide="left"/>
        <Tank x={573} y={199} w={66} h={83} label="HOUSE" value={house} litresPerPct={40} accent="#318CAC" sensorSide="left"/>

        <g transform="translate(509 194)"><circle r="7" fill={officeRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>
        <g transform="translate(580 181)"><circle r="7" fill={houseRefill ? "#4ED8F4" : "#18292D"} stroke="#4B676D"/><text x="0" y="2.5" textAnchor="middle" fill="#D9F8FE" fontSize="10">V</text></g>

        {moving && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={194 + ((phase * 3 + i * 39) % 190)} cy={208 - ((phase * 3 + i * 39) % 190) * .52} r="2.1" fill="#9AF0FF" opacity=".9" filter="url(#water-glow)"/>)}

        <text x="326" y="298" textAnchor="middle" fill="#557279" fontSize="10">Level sensors report each tank · transfer flow independently verifies physical movement · header gravity feeds house + office</text>
      </svg>
    </div>);
}
