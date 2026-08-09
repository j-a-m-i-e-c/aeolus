// Command-capable devices owned by the Agriculture simulator scenario. These
// profiles are applied through the normal authenticated Aeolus API by the seed
// job; the long-running simulator itself remains credential-free and DB-free.
export const AGRICULTURE_ACTUATOR_SPECS = [
  {
    stateTopic: "switch/farm/dam-pump/state",
    profile: { acknowledgement: { supported: true }, qos: 1 },
  },
  {
    stateTopic: "switch/fence/recall/state",
    profile: { acknowledgement: { supported: true }, qos: 1 },
  },
  {
    stateTopic: "switch/farm/trough-refill/state",
    profile: { acknowledgement: { supported: true }, qos: 1 },
  },
];
