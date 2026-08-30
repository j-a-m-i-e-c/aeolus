export const AIRFLOW_ARROWS = [
    [92, 82, 92, 68],
    [92, 150, 92, 136],
    [210, 248, 228, 248],
    [355, 248, 373, 248],
    [500, 248, 518, 248],
    [641, 205, 641, 187],
    [641, 112, 641, 94],
] as const;
export function airflowParticle(progress: number) {
    const down = 0.213;
    const across = 0.788;
    if (progress < down) {
        return { x: 92, y: 45 + (progress / down) * 203 };
    }
    if (progress < across) {
        const p = (progress - down) / (across - down);
        return { x: 92 + p * 549, y: 248 };
    }
    return { x: 641, y: 248 - ((progress - across) / (1 - across)) * 203 };
}
