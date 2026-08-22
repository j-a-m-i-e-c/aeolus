// Command-capable devices owned by the Stage Show simulator scenario.
// Applied through the normal authenticated Phase 1 device-profile API.
// Aeolus derives each command topic from the state topic (".../state" -> ".../set"),
// so only the state topic and the desired profile are declared here.
export const STAGE_SHOW_ACTUATOR_SPECS = [
  { stateTopic: "switch/stage/dmx/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/stage/fx/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
