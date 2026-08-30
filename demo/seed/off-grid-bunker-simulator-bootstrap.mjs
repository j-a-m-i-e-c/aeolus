// Command-capable devices owned by the Off-Grid Bunker simulator scenario.
// Applied through the normal authenticated Phase 1 device-profile API.
//
// The command topic is NOT declared here: Aeolus derives it from the state topic
// by replacing the last segment with "set" (see executeMqttAction), which already
// matches every BUNKER_COMMAND_TOPICS entry. The `profile` wrapper IS required —
// configureSimulatedCommandProfiles reads `spec.profile`, so a flattened spec
// would leave these actuators with no acknowledgement capability and silently
// demote every "verified" bunker command to a fire-and-forget dispatch.
export const OFF_GRID_BUNKER_ACTUATOR_SPECS = [
  { stateTopic: "switch/bunker/floodlights/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/bunker/filter/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/bunker/generator/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/bunker/radio/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
