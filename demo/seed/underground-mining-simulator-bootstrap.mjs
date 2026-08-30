// Command-capable devices owned by the Underground Mining simulator scenario.
export const UNDERGROUND_MINING_ACTUATOR_SPECS = [
  { stateTopic: "switch/mine/ventilation/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/mine/muster/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/mine/sump-pump/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
