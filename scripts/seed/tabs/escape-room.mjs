// scripts/seed/tabs/escape-room.mjs — Escape room game-master console (simulated).
// Flagship: run a live game. The visitor starts the room, sends hints, and resets
// (engine owns the game state, drives the maglock over MQTT, records the run);
// the UI shows the countdown and hint log.

const tab = { id: "tab-escape-room", name: "Escape Room", icon: "puzzle" };

const devices = [
  { topic: "switch/room/maglock", payload: { locked: false } },
  { topic: "sensor/room/props", payload: { puzzlesSolved: 0, total: 4 } },
];

const logic = `automation({
  actions: [
    function gamemaster(context) {
      var evt = String(context.topic || "").split("/").pop();
      if (evt === "start") {
        state.set("running", true);
        state.set("startedAt", Date.now());
        state.set("hints", 0);
        mqtt.publish("switch/room/maglock", JSON.stringify({ locked: true }));
        log.info("Escape room started — doors locked");
        if (db) db.write("room-runs", { event: "start" });
      } else if (evt === "reset") {
        state.set("running", false);
        state.set("hints", 0);
        mqtt.publish("switch/room/maglock", JSON.stringify({ locked: false }));
        log.info("Escape room reset — doors released");
        if (db) db.write("room-runs", { event: "reset" });
      } else if (evt === "hint") {
        state.set("hints", (Number(state.get("hints")) || 0) + 1);
        state.set("lastHint", Date.now());
        log.info("Hint delivered to players");
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const DURATION = 60 * 60; // 60 minutes

export default function GameMaster(aeolus: CustomComponentProps) {
  const running = Boolean(aeolus.read("running"));
  const startedAt = Number(aeolus.read("startedAt") ?? 0);
  const hints = Number(aeolus.read("hints") ?? 0);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = running && startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const remaining = Math.max(0, DURATION - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const urgent = remaining < 300 && running;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔓 Game Master — The Vault</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: running ? "#EF444420" : "#6B778520", color: running ? "#EF4444" : "#9AA6B2" }}>{running ? "● Live · doors locked" : "Idle · doors open"}</span>
      </div>

      <div className="bg-[#070A0E] rounded-xl border p-5 flex flex-col items-center" style={{ borderColor: urgent ? "#EF44444D" : "#2A3441" }}>
        <div className="text-[9px] text-[#6B7785] uppercase tracking-widest mb-1">Time remaining</div>
        <div className="text-5xl font-mono font-bold tabular-nums" style={{ color: urgent ? "#EF4444" : running ? "#E6EDF3" : "#6B7785" }}>{mm}:{ss}</div>
        <div className="text-[9px] text-[#9AA6B2] mt-2">{hints} hint{hints === 1 ? "" : "s"} used</div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => aeolus.fire("start")} disabled={running} className="py-2 rounded-md text-[11px] font-medium border transition-all disabled:opacity-40" style={{ background: "#22C55E15", color: "#22C55E", borderColor: "#22C55E4D" }}>▶ Start</button>
        <button onClick={() => aeolus.fire("hint")} disabled={!running} className="py-2 rounded-md text-[11px] font-medium border transition-all disabled:opacity-40" style={{ background: "#F59E0B15", color: "#F59E0B", borderColor: "#F59E0B4D" }}>💡 Hint</button>
        <button onClick={() => aeolus.fire("reset")} className="py-2 rounded-md text-[11px] font-medium border transition-all" style={{ background: "#EF444415", color: "#EF4444", borderColor: "#EF44444D" }}>↺ Reset</button>
      </div>
      <div className="text-[8px] text-[#6B7785] text-center">Start/Reset drive the door maglock over MQTT · runs recorded to the Data Store</div>
    </div>
  );
}`;

const automations = [
  {
    key: "gm",
    name: "Game Master",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { fireEvents: ["start", "reset", "hint"] },
  },
];

const panes = [
  { kind: "automation", ref: "gm", x: 0, y: 0, w: 12, h: 13 },
  { kind: "device-grid", x: 0, y: 13, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
