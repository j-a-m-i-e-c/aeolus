# MQTT load check

`mqtt-load.mjs` creates synthetic MQTT devices and publishes state at a fixed rate. It is intended for a Raspberry Pi or another edge host running a normal Aeolus stack.

Run the two baseline cases from the repository root:

```bash
node scripts/bench/mqtt-load.mjs --devices 100 --hz 1 --seconds 300
node scripts/bench/mqtt-load.mjs --devices 500 --hz 1 --seconds 300
```

Use `MQTT_URL`, `MQTT_USERNAME` and `MQTT_PASSWORD` when the broker is not the local anonymous development broker.

During each run, watch the backend container rather than only the load generator:

```bash
docker stats aeolus-backend aeolus-mosquitto
```

Also check the Aeolus metrics and automation history for event loop latency, memory growth, automation duration, queue depth and dropped executions. Disk activity is worth watching on Raspberry Pi installs because the Device Registry now batches repeated state writes instead of writing every telemetry message synchronously.

The goal is not a single marketing number. Keep the result with the Pi model, storage type, enabled automations and Aeolus commit so later changes can be compared against the same workload.

# Project API benchmark

`project-api-bench.ts` measures published Project API requests ([ADR-0027](../../docs/adr/0027-project-apis.md)) on the host it runs on. It uses the real compiler, publication and access stores, `/api/exposed` router and API sandbox, against a migrated SQLite file (WAL, as the backend opens it). The persisted automation state is about 9 KB: 24 tank records, a site record and a 1,000-point history. The server runs in a forked child process, so its CPU and memory figures exclude the load generator.

On a Raspberry Pi, from the repository root, with only Docker installed:

```bash
make bench-project-api
make bench-project-api ARGS="--seconds 30 --concurrency 1,2,4,8"
```

That builds a throwaway image (`Dockerfile.project-api`: the backend's Node image and native-module toolchain, plus dev dependencies for `tsx`) and runs the benchmark in it. The first build compiles `isolated-vm` and `better-sqlite3`, which takes several minutes on a Pi. Results print to the terminal and are written as JSON to `/tmp/aeolus-bench`, never into the repository. To run it without Docker after `npm ci`:

```bash
node --no-node-snapshot --import tsx scripts/bench/project-api-bench.ts --out result.json
```

For a clean baseline, stop the Aeolus stack first (`make down`). To see the effect of normal load on API latency, leave it running instead and record that you did.

What it reports:

| Section | Meaning |
|---|---|
| Hardware | Board, CPU, cores, memory, OS, Node and `isolated-vm` versions |
| Cold start | The first request a freshly started server answers, over a new connection, across `--cold-runs` processes. It pays for the first isolate, the first SQLite statements and the first response-schema compile |
| Warm, sequential | `--requests` back-to-back requests per route on a kept-alive connection. `tank` reads one state key; `summary` reads all of them. `server.serverDurations` is the router's own timing, to the millisecond |
| Concurrency | `--concurrency` callers, each its own API client, for `--seconds` each, at the server-wide cap of `--max-isolates` (default 4). Above the cap, callers get `503` with `Retry-After`; `okPerSecond` is what was served |
| Idle server memory | Memory after a forced GC, before and after the load |
| Isolate phases | One invocation split into isolate creation, bundle compile, bundle run and the full invocation; and compile time with and without a V8 code cache, for the benchmark bundle and for one padded to about 44 KB |
| Soak | `--soak` requests (default 10,000; `0` skips it) from four callers, with idle memory after GC sampled five times. On the development PC, 150,000 four-way invocations raised idle RSS by about 0.5 MB per 1,000 while the JS heap stayed flat, and a bare `isolated-vm` create-and-dispose loop rose at the same rate, so it is native allocator retention outside Aeolus code. Over the default 10,000 requests it is within noise. Compare the Pi's numbers with that |

CPU is the server process's user plus system time over wall time, as a percentage of one core, so it can exceed 100 when isolate threads run in parallel. Memory is the process RSS, which includes the isolates.

**Reading the phases.** A per-snapshot code cache can only remove the difference between `compile` and `compileFromCache`. Isolate creation and execution remain. Caching is worth adding only if that difference is a material share of `fullInvocation` on the Pi. Keep the JSON alongside the Pi model, storage type and Aeolus commit, as for the MQTT load check.
