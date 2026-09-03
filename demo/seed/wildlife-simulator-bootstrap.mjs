// Command-capable devices owned by the Wildlife simulator scenario.
// Applied through the normal authenticated Phase 1 device-profile API.
// Aeolus derives the command topic from the state topic (".../state" -> ".../set"),
// so only the state topic and the desired profile are declared here.
export const WILDLIFE_ACTUATOR_SPECS = [
  { stateTopic: "switch/wildlife/deterrent/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/wildlife/den-fan/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
