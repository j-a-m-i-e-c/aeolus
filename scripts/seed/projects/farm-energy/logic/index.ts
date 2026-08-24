// farm-energy — Automation Project logic
// Opportunity-load command policy lives in its own module; the entry file owns event routing.

import { initialiseEnergyState, setAction, setCharger } from "./charger-policy";

export default async function run(context: EventContext) {
      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();

      initialiseEnergyState();

      if (topic.indexOf("ui/") === 0) {
        if (evt === "simulate-low-battery") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "low-reserve");
          events.emit("farm/sim/energy-low", {});
          setAction("DEMO · injecting cloud cover + low battery reserve");
        } else if (evt === "restore-battery") {
          if (String(state.get("demoScenarioPending") || "")) return;
          state.set("demoScenarioPending", "restore");
          events.emit("farm/sim/energy-restore", {});
          setAction("DEMO · restoring nominal solar + battery reserve");
        } else if (evt === "toggle-opportunity") {
          var current = state.get("autoOpportunity");
          var enabled = current === undefined ? true : Boolean(current);
          var next = !enabled;
          state.set("autoOpportunity", next);
          if (!next) await setCharger(false, "operator disabled opportunity charging");
          else setAction("Automatic opportunity charging enabled · lowest-priority load");
        } else if (evt === "reset-energy") {
          events.emit("farm/sim/energy-reset", {});
          state.set("autoOpportunity", true);
          state.set("chargerCommandPending", false);
          state.set("demoScenarioPending", "");
          setAction("DEMO · energy system reset to nominal");
        }
        return;
      }

      if (topic !== "sensor/farm/energy/battery") return;
      var soc = Number(context.state && context.state.soc);
      var solarKw = Number(context.state && context.state.solarKw);
      var loadKw = Number(context.state && context.state.loadKw);
      var baseLoadKw = Number(context.state && context.state.baseLoadKw);
      var pumpKw = Number(context.state && context.state.pumpKw);
      var chargerKw = Number(context.state && context.state.chargerKw);
      var chargerOn = Boolean(context.state && context.state.chargerOn);
      var batteryAvailable = !(context.state && context.state.available === false);
      var allowed = batteryAvailable && (isNaN(soc) || soc >= 30);

      if (!isNaN(soc)) state.set("batterySoc", soc);
      if (!isNaN(solarKw)) state.set("solarKw", solarKw);
      if (!isNaN(loadKw)) state.set("loadKw", loadKw);
      if (!isNaN(baseLoadKw)) state.set("baseLoadKw", baseLoadKw);
      if (!isNaN(pumpKw)) state.set("pumpKw", pumpKw);
      if (!isNaN(chargerKw)) state.set("chargerKw", chargerKw);
      state.set("chargerOn", chargerOn || (!isNaN(chargerKw) && chargerKw > 0));
      state.set("batteryAvailable", batteryAvailable);
      state.set("allowed", allowed);

      var netKw = (isNaN(solarKw) ? 0 : solarKw) - (isNaN(loadKw) ? 0 : loadKw);
      var headroomBeforeCharger = (isNaN(solarKw) ? 0 : solarKw) - Math.max(0, (isNaN(loadKw) ? 0 : loadKw) - (isNaN(chargerKw) ? 0 : chargerKw));
      state.set("netKw", netKw);
      state.set("solarMarginKw", headroomBeforeCharger);

      var chargerIsOn = chargerOn || (!isNaN(chargerKw) && chargerKw > 0);
      var pumpActive = !isNaN(pumpKw) && pumpKw > 0.1;
      var mode = !allowed
        ? "reserve-protection"
        : pumpActive && !chargerIsOn
          ? "water-priority"
          : chargerIsOn
            ? "opportunity-charging"
            : netKw < 0
              ? "battery-support"
              : netKw >= 0.4
                ? "solar-surplus"
                : "balanced";
      state.set("energyMode", mode);

      var pendingScenario = String(state.get("demoScenarioPending") || "");
      if (pendingScenario === "low-reserve" && (!allowed || (!isNaN(soc) && soc <= 20))) state.set("demoScenarioPending", "");
      else if (pendingScenario === "restore" && allowed && !isNaN(soc) && soc >= 70) state.set("demoScenarioPending", "");

      var previous = state.get("previousAllowed");
      state.set("previousAllowed", allowed);
      if (allowed === false && previous !== false) {
        setAction("Reserve protection active · water transfer held and opportunity load shed");
      } else if (allowed === true && previous === false) {
        setAction("Energy reserve restored · normal load policy resumed");
      } else if (previous === undefined) {
        setAction("Energy policy online · priorities: essential > water > charging");
      }

      events.emit("farm/energy/permission", {
        allowed: allowed,
        soc: isNaN(soc) ? null : soc,
        solarKw: isNaN(solarKw) ? null : solarKw,
        loadKw: isNaN(loadKw) ? null : loadKw,
        mode: mode,
      });

      var auto = Boolean(state.get("autoOpportunity"));
      // Opportunity charging is deliberately the lowest-priority load. It can
      // start only with comfortable headroom and is shed as soon as water
      // transfer or reserve conditions consume that margin.
      if (auto && !chargerIsOn && allowed && !isNaN(soc) && soc >= 60 && headroomBeforeCharger >= 0.65) {
        await setCharger(true, "solar headroom available after higher-priority loads");
      } else if (chargerIsOn && (!auto || !allowed || (!isNaN(soc) && soc < 45) || netKw < 0.2 || (pumpActive && netKw < 0.35))) {
        await setCharger(false, !allowed ? "reserve protection" : pumpActive ? "water transfer given priority" : netKw < 0.2 ? "solar headroom exhausted" : "automatic control disabled");
      }
}
