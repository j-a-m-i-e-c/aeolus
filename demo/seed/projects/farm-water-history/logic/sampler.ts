// Tank reading detail for the Water History sampler.
// logic/index.ts keeps the recording policy visible; device access lives here.

/** Tanks recorded in one row, and the payload field each one supplies. */
const TANK_SOURCES = [
    { field: "shedCatchment", topic: "sensor/farm/dam" },
    { field: "header", topic: "sensor/farm/header-tank" },
    { field: "office", topic: "sensor/farm/shed-tank" },
    { field: "house", topic: "sensor/farm/house-tank" },
];

export type TankLevels = Record<string, number>;

/** Why a scheduled sample did not produce a row, or null once one succeeds. */
export function noteSkipped(reason: string | null) {
    state.set("lastSampleSkipped", reason === null ? null : { at: Date.now(), reason });
}

/**
 * Read the current level of every recorded tank from the device registry.
 *
 * Returns null when any tank has no usable reading. A row missing a tank would
 * read as a real observation of no water, so an incomplete sample is refused and
 * the gap in history left visible instead.
 */
export function readTankLevels(): TankLevels | null {
    const inventory = devices.list();
    const levels: TankLevels = {};

    for (const source of TANK_SOURCES) {
        const device = inventory.find((candidate) => candidate.topic === source.topic);
        const level = Number(device && device.state && device.state.value);
        if (isNaN(level)) {
            noteSkipped("no reading from " + source.topic);
            return null;
        }
        levels[source.field] = level;
    }

    return levels;
}
