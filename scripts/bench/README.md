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
