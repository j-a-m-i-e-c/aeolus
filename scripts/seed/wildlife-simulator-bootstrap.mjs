export const WILDLIFE_ACTUATOR_SPECS = [
  {
    stateTopic: "switch/wildlife/deterrent/state",
    commandTopic: "switch/wildlife/deterrent/set",
    acknowledgement: { supported: true },
    qos: 1,
  },
];
