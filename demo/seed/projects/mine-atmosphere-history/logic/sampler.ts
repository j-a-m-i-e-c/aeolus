// Gas reading detail for the Atmospheric History sampler.
// logic/index.ts keeps the recording policy visible; device access lives here.

/** Drift 7 is the recorded location; its multi-gas head supplies every channel. */
const HEAD_TOPIC = "sensor/mine/gas/drift-7";
const HEAD_LOCATION = "Drift 7";
const GAS_CHANNELS = ["ch4", "co", "o2", "no2"];

export type GasReading = Record<string, number | string>;

/** Why a scheduled sample did not produce a row, or null once one succeeds. */
export function noteSkipped(reason: string | null) {
    state.set("lastSampleSkipped", reason === null ? null : { at: Date.now(), reason });
}

/**
 * Read every gas channel from the recorded head.
 *
 * Returns null unless all channels are present. A partial row would read as a
 * real measurement of a missing gas, which in an atmospheric record is the most
 * dangerous kind of wrong, so the sample is refused and the gap left visible.
 */
export function readGases(): GasReading | null {
    const head = devices.list().find((device) => device.topic === HEAD_TOPIC);
    if (!head) {
        noteSkipped("multi-gas head not present at " + HEAD_LOCATION);
        return null;
    }

    const reading: GasReading = { location: HEAD_LOCATION };
    for (const channel of GAS_CHANNELS) {
        const value = Number(head.state && head.state[channel]);
        if (isNaN(value)) {
            noteSkipped("no " + channel + " reading at " + HEAD_LOCATION);
            return null;
        }
        reading[channel] = value;
    }

    return reading;
}
