// Command-capable devices owned by the Research Vessel simulator scenario.
// Applied through the normal authenticated Phase 1 device-profile API.
export const RESEARCH_VESSEL_ACTUATOR_SPECS = [
  { stateTopic: "switch/vessel/ctd-winch/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/rov/vehicle/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
  { stateTopic: "switch/vessel/tsg-pump/state", profile: { acknowledgement: { supported: true }, qos: 1 } },
];
