const logic = `automation({
  actions: [
    function siteEnergy(context) {
      if (String(context.topic || "") !== "sensor/farm/energy/battery") return;
      var soc = Number(context.state && context.state.soc);
      var solarKw = Number(context.state && context.state.solarKw);
      var loadKw = Number(context.state && context.state.loadKw);
      var allowed = context.state && context.state.available !== false && (isNaN(soc) || soc >= 30);

      events.emit("farm/energy/permission", {
        allowed: allowed,
        soc: isNaN(soc) ? null : soc,
        solarKw: isNaN(solarKw) ? null : solarKw,
        loadKw: isNaN(loadKw) ? null : loadKw,
      });
    },
  ],
});`;

export const energyAutomations = [
  {
    key: "farm-site-energy",
    name: "Farm Site Energy",
    triggerTopic: "sensor/farm/energy/#",
    scriptSource: logic,
  },
];
