# RainViewer radar for the Regional Conditions showcase

The Regional Conditions map draws its own radar, river gauge and RFS layers.
The optional RainViewer collector runs outside Aeolus Automation Logic because
custom UIs do not have external image/network access and the Automation Logic HTTP
API returns text rather than PNG bytes. We preserve that sandbox security rule.

The collector obtains the public RainViewer frame index and only the two required
512px Web Mercator tiles at zoom 7 for the Northern Rivers region. It samples
actual radar pixels into four 80x80, geographically aligned colour grids and
publishes one retained MQTT snapshot. The Automation Project renders them as SVG
rectangles; no map tiles, PNGs, iframe or external image is displayed in the UI.
The converted grid is radar reflectivity colour, **not rainfall mm/h**.

## API and terms

- API index: https://api.rainviewer.com/public/weather-maps.json
- API docs: https://www.rainviewer.com/api/weather-maps-api.html
- Free API terms: https://www.rainviewer.com/api.html
- Official source attribution appears visibly in the dashboard and links to RainViewer.

As of November 2026, the free API is documented for personal, educational and
small community use, with no API key and no guaranteed availability. It allows
image recolouring and transformations, but asks commercial integrations to
contact RainViewer. **Aeolus being open source does not, by itself, determine
whether using the radar on the promotional hosted demo qualifies as community
use**. Obtain confirmation if its use or audience changes. The renderer already
has stale and unavailable states because radar feeds can stop.

## Run locally

With Node 24, dependencies installed in the Aeolus repository, and a seeded
showcase with an MQTT broker:

```bash
RAINVIEWER_DRY_RUN=1 node scripts/radar/rainviewer-collector.mjs --once
node --test scripts/radar/*.test.mjs
```

Dry-run fetches real RainViewer frames and decodes them but doesn't publish to
MQTT. It may be unavailable if the service changes or radar coverage is down.

To publish to a local broker:

```bash
MQTT_BROKER_URL=mqtt://127.0.0.1:1883 \
  MQTT_USERNAME='<device-username>' MQTT_PASSWORD='<device-password>' \
  node scripts/radar/rainviewer-collector.mjs
```

Leave credentials unset when the broker permits anonymous access. The collector
refreshes roughly every ten minutes and caches unchanged frames, so ongoing
polls typically fetch only the newest image tiles. It publishes up to four
recent frames on `aeolus/local/radar/northern-rivers`, using QoS 1 and retain.
The Regional Conditions Automation Project sees the retained device snapshot
on its existing two-minute cron; WaterNSW and RFS fetches have their own throttle.

## Docker showcase deployment

The **local showcase overlay** includes the collector alongside the simulator.
Run `make showcase`, then seed the Regional Conditions project. No separate Node
process is needed. The service can be disabled in Compose if radar is unwanted.

The **hosted demo** has a separate, explicitly opt-in `radar` Compose profile.
A deployment operator can run the profile after checking RainViewer's terms for
the intended promotional use:

```bash
docker compose --project-directory . -f demo/compose/hosted-runtime.yml --profile radar up -d
```

No radar data goes to or comes from the public visitor's browser except through
Aeolus's existing device/state path. The collector has no inbound ports, no
admin API token, and no access to Aeolus's database or Docker socket.

## Observability and safety

The collector validates the API host and frame paths, refuses timestamps outside
the last two hours, caps binary responses and MQTT message size, and retains
explicit observation timestamps. The frames have 10-minute spacing. Because the
free API only offers Universal Blue and zoom up to 7, the UI makes no claim of
higher resolution or five-minute frame availability. It shows stale/unavailable
radar when the collector or provider is disconnected.

**Do not use the rendered map as a source of emergency or flood warnings.**
For emergencies, rely on the relevant issuing agencies. River heights show
metres above each gauge's own datum, not flood depth or a comparable regional
risk indicator. Numeric metre labels and colour-coded trends are complementary.
