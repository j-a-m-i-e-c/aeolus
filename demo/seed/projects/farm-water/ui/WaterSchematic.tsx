interface Props {
    source: number;
    header: number;
    office: number;
    house: number;
    moving: boolean;
    pumpOn: boolean;
    officeRefill: boolean;
    houseRefill: boolean;
    officeValveOpen: boolean;
    houseValveOpen: boolean;
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
    const left = props.sensorSide === "left";
    const sensorX = left ? -10 : props.w + 10;
    const sensorAnchor = left ? "end" : "start";
    // One number places the water and the float, so the marker cannot drift out of
    // agreement with the level it is supposed to be reporting. The float used to sit
    // at a fixed 37% of tank height while the fill moved underneath it, which made
    // the sensor look like decoration rather than the source of the reading.
    const waterlineY = props.h - 5 - fill;
    // The float rides the real surface; only its caption is repositioned, dropping
    // below the float on a near-full tank so it cannot ride up over the tank's own
    // title. Nothing about the float's position is adjusted for looks.
    const captionAbove = waterlineY > 18;
    return <g transform={`translate(${props.x} ${props.y})`}>
    <rect width={props.w} height={props.h} rx="10" fill="#0A171A" stroke="#405E64" strokeWidth="1.2"/>
    <rect x="5" y={waterlineY} width={props.w - 10} height={fill} rx="6" fill={accent} opacity=".58"/>
    {/* The surface itself, drawn so the eye connects the float outside the wall to
        the water inside it. */}
    <line x1="7" x2={props.w - 7} y1={waterlineY} y2={waterlineY} stroke="#A6ECFA" strokeOpacity=".45" strokeDasharray="3 4"/>
    <text x={props.w / 2} y="-7" textAnchor="middle" fill="#8FA4A9" fontSize="10" fontWeight="750" letterSpacing=".8">{props.label}</text>
    <text x={props.w / 2} y={props.h / 2 + 4} textAnchor="middle" fill="#E9FAFE" fontSize={props.w > 75 ? "18" : "13"} fontFamily="monospace" fontWeight="800">{Math.round(props.value)}%</text>
    <text x={props.w / 2} y={props.h / 2 + 18} textAnchor="middle" fill="#68878E" fontSize="10">{Math.round(props.value * props.litresPerPct).toLocaleString()} L</text>
    {/* Float on a guide rail: the rail spans the tank's travel, the float sits where
        the water actually is. */}
    <line x1={sensorX} y1="5" x2={sensorX} y2={props.h - 5} stroke="#2C464B" strokeWidth="1" strokeDasharray="2 3"/>
    <g transform={`translate(${sensorX} ${waterlineY})`}>
      <circle r="6" fill="#0B1D21" stroke="#76D9ED" strokeWidth="1.2"/>
      <circle r="2" fill="#88E9F8"/>
      <line x1={left ? 6 : -6} y1="0" x2={left ? 13 : -13} y2="0" stroke="#466D74" strokeWidth="1"/>
      <text x={left ? -9 : 9} y={captionAbove ? -9 : 13} textAnchor={sensorAnchor} fill="#6E9198" fontSize="8" fontWeight="700">LEVEL SENSOR</text>
    </g>
  </g>;
}
/**
 * A header-feed valve, drawn as a valve.
 *
 * This replaces a small circle containing the letter V, which a visitor had no way to
 * decode (showcase-cleanup §4.2, §13.3). The conventional two-triangle body plus an
 * explicit state caption means the symbol needs no legend.
 *
 * `open` is the valve controller's reported position OR an accepted open command still
 * in flight. Both are honest about position; neither is offered as proof that water
 * arrived — the refill command proves that separately against the receiving tank's own
 * level sensor.
 */
function Valve(props: { x: number; y: number; open: boolean }) {
    const body = props.open ? "#3FCDEC" : "#16262A";
    const edge = props.open ? "#8DEBFF" : "#4B676D";
    return <g transform={`translate(${props.x} ${props.y})`}>
    <text y="-11" textAnchor="middle" fill={props.open ? "#8FE6F8" : "#61787D"} fontSize="7.5" fontWeight="800" letterSpacing=".4">{props.open ? "VALVE OPEN" : "VALVE CLOSED"}</text>
    <path d="M-8 -6 L-8 6 L0 0 Z" fill={body} stroke={edge} strokeWidth="1.1"/>
    <path d="M8 -6 L8 6 L0 0 Z" fill={body} stroke={edge} strokeWidth="1.1"/>
    <circle r="1.6" fill={edge}/>
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
export function WaterSchematic({ source, header, office, house, moving, pumpOn, officeRefill, houseRefill, officeValveOpen, houseValveOpen, phase }: Props) {
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

        {/* On their own feed lines, in the clear band between the header tank's base
            and the two downstream tanks, so each caption has room to be read. */}
        <Valve x={468} y={201} open={officeValveOpen}/>
        <Valve x={532} y={193} open={houseValveOpen}/>

        {moving && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={194 + ((phase * 3 + i * 39) % 190)} cy={208 - ((phase * 3 + i * 39) % 190) * .52} r="2.1" fill="#9AF0FF" opacity=".9" filter="url(#water-glow)"/>)}

        <text x="326" y="298" textAnchor="middle" fill="#557279" fontSize="10">Each float sits at the level its sensor reports · transfer flow independently verifies physical movement · header gravity feeds house + office</text>
      </svg>
    </div>);
}
