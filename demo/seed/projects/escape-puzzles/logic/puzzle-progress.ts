// Physical puzzle-network projection and demo helpers.
function puzzleSensor() {
    return devices.list().find((device) => device.topic === "sensor/escape/puzzles");
}
function setAction(label: string) {
    state.set("lastAction", { label, at: Date.now() });
}
export function handlePuzzleDemoEvent(event: string | undefined) {
    if (event === "simulate-solve") {
        events.emit("escape/sim/solve-next", {});
        setAction("Injecting the next participant puzzle solve");
    }
    else if (event === "reset-puzzles") {
        events.emit("escape/sim/reset", {});
        state.set("previousSolved", -1);
        state.set("publishedInitial", false);
        setAction("Resetting physical puzzle network");
    }
}
export function projectPuzzleNetwork() {
    const sensor = puzzleSensor();
    const observed = sensor && sensor.state ? sensor.state : {};
    const keys = ["p1", "p2", "p3", "p4"];
    const values = keys.map((key) => Boolean(observed[key]));
    const solved = values.filter(Boolean).length;
    const attempts = Array.isArray(observed.attempts) ? observed.attempts : [0, 0, 0, 0];
    const solveSeconds = Array.isArray(observed.solveSeconds) ? observed.solveSeconds : [0, 0, 0, 0];
    const lastSolved = Number(observed.lastSolved || 0);
    const currentRoom = String(observed.currentRoom || "Library");
    keys.forEach((key, index) => state.set(key, values[index]));
    state.set("solved", solved);
    state.set("lastSolved", lastSolved);
    state.set("currentRoom", currentRoom);
    state.set("teamProgress", String(observed.teamProgress || "searching"));
    state.set("attempts", attempts);
    state.set("solveSeconds", solveSeconds);
    return { values, solved, attempts, solveSeconds, lastSolved, currentRoom };
}
export function publishPuzzleProgress(progress: ReturnType<typeof projectPuzzleNetwork>) {
    const previous = Number(state.get("previousSolved") || 0);
    const changed = previous !== progress.solved;
    const firstPublish = state.get("publishedInitial") !== true;
    if (!changed && !firstPublish)
        return;
    if (changed) {
        state.set("previousSolved", progress.solved);
        setAction(progress.solved === 4
            ? "Final puzzle physically solved"
            : "Puzzle " + Number(progress.lastSolved || progress.solved) + " solved by team");
    }
    else {
        state.set("publishedInitial", true);
    }
    events.emit("escape/puzzles/status", {
        p1: progress.values[0],
        p2: progress.values[1],
        p3: progress.values[2],
        p4: progress.values[3],
        solved: progress.solved,
        complete: progress.solved === 4,
        lastSolved: progress.lastSolved,
        currentRoom: progress.currentRoom,
        attempts: progress.attempts,
        solveSeconds: progress.solveSeconds,
    });
}
