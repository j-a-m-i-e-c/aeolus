// escape-game-master — visual implementation behind ui/index.tsx
import { useEffect, useState } from "react";
import { control } from "@aeolus/ui";
const ROOMS = ["Library", "Laser Hall", "Observatory", "Vault"];
/**
 * How each room look reads on the plan.
 *
 * The look used to appear only as a line of text in the comms card, which told an
 * operator nothing about the room they were actually running. The depicted active
 * room now carries the look itself, and pulses harder as the game gets tenser.
 */
const LOOKS: Record<string, {
    label: string;
    fill: string;
    stroke: string;
    text: string;
    pulseSec: number;
}> = {
    calm: { label: "CALM", fill: "#102636", stroke: "#4BB8FF", text: "#9FD9FF", pulseSec: 4.2 },
    puzzle: { label: "PUZZLE", fill: "#271B2E", stroke: "#B26BFF", text: "#E0B2F1", pulseSec: 2.6 },
    tension: { label: "TENSE", fill: "#33141A", stroke: "#FF625C", text: "#FFA9A4", pulseSec: 1 },
    victory: { label: "VICTORY", fill: "#1C2B15", stroke: "#8FE08A", text: "#D2EFA6", pulseSec: 3.4 },
};
export default function GameMasterConsole({ model, actions }: {
    model: Record<string, any>;
    actions: Record<string, (...args: any[]) => void>;
}) {
    const solved = Number(model.solved ?? 0), p = [Boolean(model.p1), Boolean(model.p2), Boolean(model.p3), Boolean(model.p4)], base = Number(model.remaining ?? 2700), started = Number(model.timerStartedAt ?? Date.now()), paused = Boolean(model.paused), exit = Boolean(model.exitUnlocked), currentRoom = String(model.currentRoom || "Library"), hints = Number(model.hintsSent ?? 0), hint = String(model.lastHint || "No hint sent yet."), hintId = Number(model.lastHintId ?? 0), hintRoom = String(model.hintRoom || "Library"), pending = Boolean(model.pendingHint), talking = Boolean(model.intercomTx), intercomPending = Boolean(model.intercomPending), look = String(model.requestedLook || "puzzle"), last = model.lastAction as any;
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
    const remaining = Math.max(0, base - (paused ? 0 : Math.floor((now - started) / 1000))), clock = String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0");
    const session = (e: string) => actions.session(e, remaining);
    const hintAction = (e: string) => actions.hint(e, remaining);
    const roomLook = (e: string) => actions.roomLook(e, remaining);
    const talkStart = () => { if (!talking && !intercomPending)
        actions.talkStart(); };
    const talkStop = () => { if (talking || intercomPending)
        actions.talkStop(); };
    // A hint is delivered to a physical screen in the room, so the wait for that
    // to be confirmed is real and the buttons say so rather than going quietly inert.
    const hintVisual = control({ pending });
    // Opening the mic is a request to the room's intercom, so the wait is real too.
    // This button used to carry a bare `disabled` attribute: while the request was in
    // flight it went inert but kept its colour, its pointer cursor and the label
    // "HOLD TO TALK", so the only way to discover the wait was that pressing did
    // nothing. The kit's pending state is what makes that wait visible.
    const micVisual = control({ pending: intercomPending });
    // Requested is what this console asked for; applied is what the room controller
    // reports it is actually doing. The gap between them is Room Systems working, so
    // the plan shows the request immediately and only claims APPLIED once observed.
    const applied = String(model.appliedLook || "puzzle");
    const lookApplied = applied === look;
    const skin = LOOKS[look] || LOOKS.puzzle;
    const appliedSkin = LOOKS[applied] || LOOKS.puzzle;
    return <div style={{ padding: 14, minHeight: "100%", background: "linear-gradient(180deg,#0D0B10,#08070A)", color: "#F0EBF3" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 12 }}><div><div style={{ fontSize: 18, fontWeight: 900 }}>GAME MASTER</div><div style={{ fontSize: 12, color: "#8E8393", marginTop: 3 }}>Session clock · hints · intercom · room looks · verified exit release</div></div><div style={{ textAlign: "right" }}><div style={{ fontFamily: "monospace", fontSize: 25, fontWeight: 900, color: remaining < 300 ? "#F06E69" : "#76DB98" }}>{clock}</div><div style={{ fontSize: 11, color: "#857A89" }}>{paused ? "PAUSED" : solved + "/4 solved · team in " + currentRoom}</div></div></div>
    <div style={{ border: "1px solid #302A34", borderRadius: 13, background: "#0A090B", padding: 8 }}><svg width="100%" height="290" viewBox="0 0 760 280"><rect x="24" y="22" width="540" height="220" rx="7" fill="#17121A" stroke="#4A3E50"/>{ROOMS.map((room, i) => { const x = 48 + i * 126, done = p[i], active = currentRoom === room && !exit; return <g key={room} transform={"translate(" + x + " 62)"}>
      {/* The room the team is in wears the requested look, so choosing TENSE changes
          the room on the plan rather than only a line of text in the comms card. */}
      <rect width="105" height="82" rx="5" fill={active ? skin.fill : done ? "#142219" : "#201823"} stroke={active ? skin.stroke : done ? "#60D488" : "#6C526F"} strokeWidth={active ? 2 : 1}>{active && <animate attributeName="stroke-opacity" values="1;.4;1" dur={skin.pulseSec + "s"} repeatCount="indefinite"/>}</rect>
      <text x="52.5" y="24" textAnchor="middle" fill={done ? "#8EE0A6" : active ? skin.text : "#C4A9C8"} fontSize="10" fontWeight="800">{room.toUpperCase()}</text>
      <text x="52.5" y="48" textAnchor="middle" fill={done ? "#7CE19C" : active ? skin.text : "#A68AAF"} fontSize="19">{done ? "✓" : i + 1}</text>
      {active && <g><circle cx="46" cy="60" r="3.5" fill="#F4C96B"/><text x="54" y="63" fill="#F4C96B" fontSize="9">TEAM</text></g>}
      {active && <g><rect y="67" width="105" height="15" fill={skin.stroke} opacity=".2"/><text x="52.5" y="78" textAnchor="middle" fill={skin.text} fontSize="9" fontWeight="800">{skin.label} · {lookApplied ? "APPLIED" : "PENDING"}</text></g>}
    </g>; })}<path d="M153 103 H174 M279 103 H300 M405 103 H426" fill="none" stroke="#7D5D8B" strokeDasharray="4 4"/><g transform="translate(482 164)"><rect width="47" height="62" fill={exit ? "#173924" : "#28181B"} stroke={exit ? "#70DD96" : "#88545A"}/><circle cx="37" cy="31" r="2" fill="#D3B45C"/><text x="23" y="76" textAnchor="middle" fill={exit ? "#7DE19D" : "#C1787D"} fontSize="10">{exit ? "EXIT OPEN" : "MAGLOCK"}</text></g><rect x="50" y="170" width="390" height="53" rx="6" fill="#0E1519" stroke="#3C5360"/><text x="62" y="187" fill="#79A8BB" fontSize="10">HINT SCREEN · {hintId ? "HINT #" + hintId + " → " + hintRoom : "READY"}</text><text x="62" y="207" fill="#C8E0E8" fontSize="10">{hint}</text><g transform="translate(584 24)"><rect width="150" height="214" rx="8" fill="#0E0C10" stroke="#302A34"/><text x="14" y="25" fill="#8C8290" fontSize="10">GAME MASTER COMMS</text><circle cx="75" cy="76" r="35" fill={talking ? "#3A1623" : "#151118"} stroke={talking ? "#F06F86" : "#5E4B63"} strokeWidth="2"/><path d="M67 59 v31 M58 66 v17 q0 12 17 12 q17 0 17-12 V66" fill="none" stroke={talking ? "#FF9BAD" : "#9D86A5"} strokeWidth="4" strokeLinecap="round"/><text x="75" y="126" textAnchor="middle" fill={talking ? "#FF92A8" : "#B9A7BE"} fontSize="11" fontWeight="800">{talking ? "LIVE" : "PTT READY"}</text><text x="75" y="146" textAnchor="middle" fill="#86798A" fontSize="10">{currentRoom.toUpperCase()}</text>{/* The room look belongs on the room, not in the comms card. */}<text x="14" y="185" fill="#7F7583" fontSize="10">HINTS SENT</text><text x="136" y="185" textAnchor="end" fill="#C897E2" fontSize="10">{hints}</text></g></svg></div>
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr 1fr 1.15fr", gap: 8, marginTop: 9 }}><div style={{ border: "1px solid #302A34", borderRadius: 10, padding: 9, background: "#0E0C10" }}><div style={{ fontSize: 11, color: "#A097A5", letterSpacing: ".08em", marginBottom: 7 }}>SESSION</div><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}><button onClick={() => session("add-time")} style={{ padding: "9px 3px", borderRadius: 7, border: "1px solid #365642", background: "#102018", color: "#80D99B", fontSize: 12 }}>+1 min</button><button onClick={() => session("sub-time")} style={{ padding: "9px 3px", borderRadius: 7, border: "1px solid #5A4931", background: "#20190F", color: "#E0B66A", fontSize: 12 }}>-1 min</button><button onClick={() => session("pause")} style={{ padding: "9px 3px", borderRadius: 7, border: "1px solid #36556A", background: "#101C24", color: "#80C9EC", fontSize: 12 }}>{paused ? "Resume" : "Pause"}</button></div></div>
    <div style={{ border: "1px solid #302A34", borderRadius: 10, padding: 9, background: "#0E0C10" }}><div style={{ fontSize: 11, color: "#A097A5", letterSpacing: ".08em", marginBottom: 7 }}>HINT TO {currentRoom.toUpperCase()}</div><div style={{ display: "flex", gap: 5 }}>{[["hint-nudge", "NUDGE"], ["hint-strong", "STRONG"], ["hint-solve", "SOLUTION"]].map((x: any) => <button key={x[0]} {...hintVisual} onClick={() => hintAction(x[0])} style={{ ...hintVisual.style, flex: 1, padding: "9px 3px" }}>{pending ? "SENDING…" : x[1]}</button>)}</div></div>
    <div style={{ border: "1px solid #302A34", borderRadius: 10, padding: 9, background: "#0E0C10" }}><div style={{ fontSize: 11, color: "#A097A5", letterSpacing: ".08em", marginBottom: 7 }}>ROOM LOOK</div><div style={{ display: "flex", gap: 5 }}>{["calm", "puzzle", "tension"].map((scene) => { const s = LOOKS[scene]; const requested = look === scene, live = applied === scene;
      // Scene colour is kept because it is genuinely informative, but the request and
      // the physical state are separate facts, so they are marked separately.
      return <button key={scene} aria-pressed={requested} onClick={() => roomLook("look-" + scene)} style={{ flex: 1, padding: "9px 3px", borderRadius: 7, border: (requested ? "2px solid " : "1px solid ") + (requested ? s.stroke : s.stroke + "55"), background: requested ? s.stroke + "2E" : s.stroke + "14", color: requested ? s.text : s.stroke, fontSize: 11, fontWeight: requested ? 800 : 600, cursor: "pointer" }}>{s.label}{live ? " ●" : requested ? " ○" : ""}</button>; })}</div><div style={{ fontSize: 10, color: "#7C7280", marginTop: 6 }}>● in the room now · ○ requested, Room Systems applying</div></div>
    <div style={{ border: "1px solid " + (talking ? "#8E3E55" : "#49394F"), borderRadius: 10, padding: 9, background: talking ? "#1B0E13" : "#0E0C10" }}><div style={{ fontSize: 11, color: "#A097A5", letterSpacing: ".08em", marginBottom: 7 }}>GAME MASTER MIC · {currentRoom.toUpperCase()}</div><button {...micVisual} aria-pressed={talking} onPointerDown={talkStart} onPointerUp={talkStop} onPointerLeave={talkStop} onPointerCancel={talkStop} style={{ ...micVisual.style, width: "100%", padding: "10px", fontSize: 12, fontWeight: 800, userSelect: "none", ...(talking ? { border: "1px solid #EC6A85", background: "#451824", color: "#FFB0C0" } : {}) }}>{intercomPending ? "OPENING MIC…" : talking ? "● LIVE · RELEASE TO STOP" : "HOLD TO TALK"}</button></div></div>
    <div style={{ fontSize: 11, color: "#777079", marginTop: 7 }}>{last?.label ? String(last.label) : "Game session ready"}</div></div>;
}
