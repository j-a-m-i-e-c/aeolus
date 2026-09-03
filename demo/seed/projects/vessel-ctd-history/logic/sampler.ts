// Sonde reading detail for the CTD History sampler.
// logic/index.ts keeps the recording policy visible; device access lives here.

/** The CTD sonde supplies every field of a cast row. */
const SONDE_TOPIC = "sensor/ctd/sonde";
const SONDE_FIELDS = ["depth", "temperature", "salinity", "oxygen"];

export type CastReading = Record<string, number>;

/** Why a scheduled sample did not produce a row, or null once one succeeds. */
export function noteSkipped(reason: string | null) {
    state.set("lastSampleSkipped", reason === null ? null : { at: Date.now(), reason });
}

/**
 * Read the sonde's current cast values.
 *
 * Returns null unless every field is present. A cast row with a missing channel
 * would read as a real measurement rather than an absent one, so the sample is
 * refused and the gap left visible.
 */
export function readCast(): CastReading | null {
    const sonde = devices.list().find((device) => device.topic === SONDE_TOPIC);
    if (!sonde) {
        noteSkipped("CTD sonde not present");
        return null;
    }

    const reading: CastReading = {};
    for (const field of SONDE_FIELDS) {
        const value = Number(sonde.state && sonde.state[field]);
        if (isNaN(value)) {
            noteSkipped("no " + field + " reading from the sonde");
            return null;
        }
        reading[field] = value;
    }

    return reading;
}
