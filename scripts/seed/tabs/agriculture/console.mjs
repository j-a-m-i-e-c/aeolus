import { ui } from "./ui.mjs";

const logic = `automation({
  actions: [
    function farmConsole(context) {
      function setAction(label) {
        state.set("lastAction", { label: label, at: Date.now() });
      }

      var topic = String(context.topic || "");
      var evt = topic.split("/").pop();
      var payload = context.state || {};

      // UI intents are deliberately translated into bounded domain events. The
      // console never mutates physical state and never sends device commands.
      if (topic.indexOf("ui/") === 0) {
        if (evt === "transfer-500") {
          events.emit("farm/water/transfer-request", { litres: 500, source: "operator" });
          setAction("500 L transfer requested");
        } else if (evt === "transfer-1000") {
          events.emit("farm/water/transfer-request", { litres: 1000, source: "operator" });
          setAction("1000 L transfer requested");
        } else if (evt === "pump-stop") {
          events.emit("farm/water/stop-request", { source: "operator" });
          setAction("Transfer pump stop requested");
        } else if (evt === "simulate-header-low") {
          events.emit("farm/sim/header-low", {});
          setAction("Simulating header-tank drawdown");
        } else if (evt === "recall-strays") {
          events.emit("farm/livestock/recall-request", { source: "operator" });
          setAction("Virtual-fence recall requested");
        } else if (evt === "simulate-strays") {
          events.emit("farm/sim/livestock-boundary-breach", {});
          setAction("Simulating a boundary crossing");
        } else if (evt === "refill-troughs") {
          events.emit("farm/troughs/refill-request", { source: "operator" });
          setAction("Trough refill requested");
        } else if (evt === "simulate-low-troughs") {
          events.emit("farm/sim/troughs-low", {});
          setAction("Simulating low trough levels");
        } else if (evt === "simulate-low-battery") {
          events.emit("farm/sim/energy-low", {});
          setAction("Simulating low site battery");
        } else if (evt === "restore-battery") {
          events.emit("farm/sim/energy-restore", {});
          setAction("Restoring site battery reserve");
        } else if (evt === "reset-farm") {
          events.emit("farm/sim/reset", {});
          setAction("Property reset requested");
        }
        return;
      }

      // Domain events are status/provenance only. The UI's physical values come
      // directly from aeolus.devices, so these labels can never fake device state.
      if (topic.indexOf("/farm/water/transfer-started") >= 0) {
        setAction("Water transfer verified at " + String(payload.flowLpm || 0) + " L/min");
      } else if (topic.indexOf("/farm/water/transfer-blocked") >= 0) {
        setAction("Water transfer blocked: " + String(payload.reason || "preflight failed"));
      } else if (topic.indexOf("/farm/water/transfer-stopped") >= 0) {
        setAction("Transfer pump stopped and zero flow observed");
      } else if (topic.indexOf("/farm/livestock/breach") >= 0) {
        setAction(String(payload.strays || 0) + " collars outside the virtual fence");
      } else if (topic.indexOf("/farm/livestock/contained") >= 0) {
        setAction("Virtual-fence recall complete; herd contained");
      } else if (topic.indexOf("/farm/troughs/refill-complete") >= 0) {
        setAction("Trough refill complete");
      } else if (topic.indexOf("/farm/troughs/low") >= 0) {
        setAction(String(payload.low || 0) + " troughs require water");
      } else if (topic.indexOf("/farm/energy/permission") >= 0) {
        if (payload.allowed === false) setAction("Site energy reserve is protecting discretionary loads");
      }
    },
  ],
});`;

export const consoleAutomation = {
  key: "farm-console",
  name: "Farm Operations Console",
  triggerTopic: "aeolus/events/+/farm/#",
  scriptSource: logic,
  uiSource: ui,
  demoAccess: {
    fireEvents: [
      "transfer-500",
      "transfer-1000",
      "pump-stop",
      "simulate-header-low",
      "recall-strays",
      "simulate-strays",
      "refill-troughs",
      "simulate-low-troughs",
      "simulate-low-battery",
      "restore-battery",
      "reset-farm",
    ],
  },
};
