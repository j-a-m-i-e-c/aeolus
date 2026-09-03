// Sump reading detail for the Dewatering History sampler.
// logic/index.ts keeps the recording policy visible; device access lives here.

const SUMP_TOPIC = "sensor/mine/sump/deep";
const PUMP_TOPIC = "switch/mine/sump-pump/state";

export type SumpReading = Record<string, number>;

/** Why a scheduled sample did not produce a row, or null once one succeeds. */
export function noteSkipped(reason: string | null) {
    state.set("lastSampleSkipped", reason === null ? null : { at: Date.now(), reason });
}

/**
 * Read the sump level, inflow and pump duty.
 *
 * Returns null unless both the sump and the pump are readable. The previous
 * in-line sampler defaulted a missing level and inflow to zero, which recorded a
 * dry sump with no inflow as though it had been measured; an unreadable sump is
 * now a skipped sample instead.
 */
export function readSump(): SumpReading | null {
    const inventory = devices.list();
    const sump = inventory.find((device) => device.topic === SUMP_TOPIC);
    const pump = inventory.find((device) => device.topic === PUMP_TOPIC);

    if (!sump) {
        noteSkipped("deep sump sensor not present");
        return null;
    }
    if (!pump) {
        noteSkipped("sump pump not present");
        return null;
    }

    const levelM = Number(sump.state && sump.state.levelM);
    const inflowLps = Number(sump.state && sump.state.inflowLps);
    if (isNaN(levelM)) {
        noteSkipped("no level reading from the deep sump");
        return null;
    }
    if (isNaN(inflowLps)) {
        noteSkipped("no inflow reading from the deep sump");
        return null;
    }

    // Duty is derived from the pump's own reported state, not from what Aeolus
    // last asked it to do.
    const pumpDutyPct = Boolean(pump.state && pump.state.on) ? 100 : 0;

    return { levelM, inflowLps, pumpDutyPct };
}
