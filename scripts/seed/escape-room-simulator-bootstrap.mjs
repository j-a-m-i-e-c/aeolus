// Command-capable devices owned by the Escape Room simulator scenario.
// Applied through the normal authenticated Phase 1 device-profile API.
// Aeolus derives each command topic from the state topic (".../state" -> ".../set"),
// so only the state topic and the desired profile are declared here.
export const ESCAPE_ROOM_ACTUATOR_SPECS = [
  { stateTopic: "switch/escape/exit/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/escape/hint-screen/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/escape/fx/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/escape/intercom/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
