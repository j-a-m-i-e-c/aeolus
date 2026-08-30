// Data Store collections for the Stage & Show tab. Shape matches seedCollection():
// an array of { name, description?, retentionDays?, records: [{payload, timestamp?}] }.
// The Show Sequencer Logic appends live rows to "show-cues" (same payload shape).
export const dataStore = [
  {
    name: "show-cues",
    description: "Stage cue and physical-FX event history from the seeded show-control demo.",
    retentionDays: 7,
    records: [
      { payload: { type: "scene", cue: "wash", label: "Open Wash" }, timestamp: Date.now() - 180000 },
      { payload: { type: "scene", cue: "verse", label: "Verse" }, timestamp: Date.now() - 120000 },
      { payload: { type: "scene", cue: "chorus", label: "Chorus" }, timestamp: Date.now() - 60000 },
    ],
  },
];
