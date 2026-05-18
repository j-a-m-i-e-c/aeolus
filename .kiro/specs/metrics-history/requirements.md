# Requirements Document

## Introduction

Aeolus currently exposes real-time observability metrics via a `MetricsService` singleton (prom-client) with 19 custom metrics covering MQTT throughput, device counts, automation execution rates, connector health, WebSocket activity, HTTP request stats, and Node.js runtime metrics. The frontend MetricsPane displays these as point-in-time numeric cards. However, there is no historical view — users cannot see how metrics have trended over the past hour or day without external tools like Prometheus or Grafana.

This spec introduces a **Two-Tier Metrics History** system:

- **Tier 1 (Ephemeral):** A high-resolution sampling service that reads metric values from the prom-client registry every 30 seconds and writes them into `_metrics:live:*` collections with 10-minute retention. These power live sparkline charts showing the last hour at full 30-second resolution via direct query.

- **Tier 2 (Permanent):** A 5-minute aggregation service that computes avg, peak, and spike values from the ~10 Tier 1 samples accumulated during each 5-minute window, then writes a single summary record into `_metrics:history:*` collections with no retention (kept forever). These power long-term trend charts (6h, 24h, 7d, 30d).

The storage footprint is minimal: ~288 records/day × 4 collections × ~250 bytes ≈ 70 MB/year for the permanent tier. The ephemeral tier self-prunes after 10 minutes via Data Store retention enforcement.

The frontend gains SVG sparkline/trend charts with time-range selection: the 1-hour view uses full-resolution Tier 1 data, while 6h/24h/7d/30d views use 5-minute aggregates from Tier 2.

## Glossary

- **Metrics_History_Service**: The backend singleton service responsible for both Tier 1 sampling and Tier 2 aggregation of metric values from the prom-client registry into Data Store collections.
- **Tier_1_Sample**: A single timestamped record containing raw metric values sampled at 30-second intervals, stored in ephemeral `_metrics:live:*` collections.
- **Tier_2_Aggregate**: A single timestamped record containing avg, peak, and spike values computed from one 5-minute window of Tier 1 samples, stored permanently in `_metrics:history:*` collections.
- **Ephemeral_Collection**: A Data Store time-series collection prefixed with `_metrics:live:` that stores high-resolution samples with 10-minute retention. Examples: `_metrics:live:system`, `_metrics:live:mqtt`.
- **Permanent_Collection**: A Data Store time-series collection prefixed with `_metrics:history:` that stores 5-minute aggregates with no retention (kept forever). Examples: `_metrics:history:system`, `_metrics:history:mqtt`.
- **Sampling_Interval**: The time period between consecutive Tier 1 metric samples. Fixed at 30 seconds.
- **Aggregation_Interval**: The time period between consecutive Tier 2 aggregation cycles. Fixed at 5 minutes (300,000 milliseconds).
- **Rate_Computation**: The process of computing a per-second rate from a monotonic counter by calculating (current_value - previous_value) / interval_seconds between consecutive samples.
- **Spike_Detection**: The process of identifying outlier values within a 5-minute aggregation window. A spike is detected when any sample value exceeds 2× the average for that metric field in the window. Only the single highest outlier per metric per window is recorded.
- **Spike_Threshold_Multiplier**: A compile-time constant (default: 2.0) that defines the multiplier applied to the window average to determine the spike threshold. Not configurable via environment variable.
- **Sparkline_Chart**: A compact SVG line chart showing metric values over time, rendered inline within the metrics dashboard pane.
- **Time_Range_Selector**: A UI control allowing the user to choose the displayed time window for metric charts (1h, 6h, 24h, 7d, 30d).
- **Data_Store**: The existing persistent time-series collection system backed by SQLite (better-sqlite3) that provides write, query, and retention operations.
- **MetricsService**: The existing prom-client singleton that collects and exposes Prometheus-compatible metrics from all Aeolus subsystems.

## Requirements

### Requirement 1: Tier 1 — Periodic High-Resolution Sampling

**User Story:** As a user, I want the system to automatically sample key metric values every 30 seconds, so that I can see a live sparkline of the last hour at full resolution.

#### Acceptance Criteria

1. WHEN the Aeolus backend starts and the Data_Store is enabled, THE Metrics_History_Service SHALL begin sampling metric values from the prom-client registry every 30,000 milliseconds.
2. THE Metrics_History_Service SHALL write each Tier_1_Sample to the appropriate `_metrics:live:*` Ephemeral_Collection.
3. WHILE the Data_Store is disabled, THE Metrics_History_Service SHALL NOT attempt to write Tier_1_Sample records.
4. WHEN the Data_Store transitions from disabled to enabled, THE Metrics_History_Service SHALL begin sampling on the next interval tick.
5. WHEN the Data_Store transitions from enabled to disabled, THE Metrics_History_Service SHALL stop writing Tier_1_Sample records but continue running the interval timer.
6. THE Metrics_History_Service SHALL configure a retention period of 10 minutes on all `_metrics:live:*` Ephemeral_Collections.
7. THE Data_Store existing retention enforcement mechanism SHALL handle pruning of expired Tier_1_Sample records.

### Requirement 2: Counter Rate Computation

**User Story:** As a user, I want counter metrics displayed as rates (messages per second) rather than raw totals, so that trend charts show meaningful throughput information.

#### Acceptance Criteria

1. THE Metrics_History_Service SHALL store the previous sample values for all counter metrics between sampling cycles.
2. WHEN a counter metric is sampled, THE Metrics_History_Service SHALL compute the rate as (current_value - previous_value) / (interval_seconds).
3. WHEN the Metrics_History_Service starts for the first time (no previous sample exists), THE Metrics_History_Service SHALL skip writing rate values for the first sample and only store the raw counter values for the next computation.
4. IF a counter value decreases between samples (indicating a process restart or registry reset), THEN THE Metrics_History_Service SHALL treat the current value as the new baseline and skip the rate computation for that sample.

### Requirement 3: Tier 1 Snapshot Record Structure

**User Story:** As a developer, I want Tier 1 samples organized into logical collections with a consistent naming convention, so that they are easy to query and visually grouped.

#### Acceptance Criteria

1. THE Metrics_History_Service SHALL write Tier_1_Sample records to collections using the `_metrics:live:` prefix convention.
2. THE Metrics_History_Service SHALL write system metrics to the `_metrics:live:system` collection with payload fields: `memoryUsageMb` (number), `eventLoopLagMs` (number), `uptimeSeconds` (number).
3. THE Metrics_History_Service SHALL write MQTT metrics to the `_metrics:live:mqtt` collection with payload fields: `messagesReceivedRate` (number), `messagesPublishedRate` (number), `connected` (number, 1 or 0).
4. THE Metrics_History_Service SHALL write automation metrics to the `_metrics:live:automations` collection with payload fields: `executionRate` (number), `errorRate` (number), `activeRules` (number).
5. THE Metrics_History_Service SHALL write HTTP metrics to the `_metrics:live:http` collection with payload fields: `requestRate` (number).
6. WHEN writing a Tier_1_Sample record, THE Metrics_History_Service SHALL include a `timestamp` field set to the current time in milliseconds since epoch.

### Requirement 4: Tier 2 — 5-Minute Aggregation

**User Story:** As a user, I want the system to permanently save a compact 5-minute summary of metrics, so that I can understand what has happened historically with good resolution and without consuming significant storage.

#### Acceptance Criteria

1. THE Metrics_History_Service SHALL execute an aggregation cycle every 300,000 milliseconds (5 minutes).
2. WHEN an aggregation cycle executes, THE Metrics_History_Service SHALL query all Tier_1_Sample records from the preceding 5-minute window in each `_metrics:live:*` collection.
3. THE Metrics_History_Service SHALL compute avg and peak values from the queried Tier_1_Sample records for each numeric metric field.
4. THE Metrics_History_Service SHALL write one Tier_2_Aggregate record per collection to the corresponding `_metrics:history:*` Permanent_Collection.
5. THE `_metrics:history:*` Permanent_Collections SHALL have no retention period configured (records are kept forever).
6. IF fewer than 2 Tier_1_Sample records exist for a given 5-minute window, THEN THE Metrics_History_Service SHALL skip aggregation for that collection and log a warning.

### Requirement 5: Tier 2 Aggregate Record Structure

**User Story:** As a developer, I want the permanent 5-minute aggregate records to contain avg, peak, and spike values in a structured format, so that frontend charts can display meaningful trend data and highlight anomalies.

#### Acceptance Criteria

1. THE Metrics_History_Service SHALL write Tier_2_Aggregate records to collections using the `_metrics:history:` prefix convention.
2. THE Tier_2_Aggregate record for `_metrics:history:mqtt` SHALL include fields: `avgMessagesPerSec` (number), `peakMessagesPerSec` (number), `connectedPct` (number, percentage of samples where connected was 1).
3. THE Tier_2_Aggregate record for `_metrics:history:system` SHALL include fields: `avgMemoryMb` (number), `peakMemoryMb` (number), `avgEventLoopLagMs` (number), `peakEventLoopLagMs` (number).
4. THE Tier_2_Aggregate record for `_metrics:history:automations` SHALL include fields: `totalExecutions` (number, sum of executionRate × interval across samples), `totalErrors` (number, sum of errorRate × interval across samples), `avgActiveRules` (number).
5. THE Tier_2_Aggregate record for `_metrics:history:http` SHALL include fields: `totalRequests` (number, sum of requestRate × interval across samples), `avgResponseMs` (number).
6. WHEN writing a Tier_2_Aggregate record, THE Metrics_History_Service SHALL set the `timestamp` field to the start of the aggregated 5-minute window (aligned to the 5-minute boundary in milliseconds since epoch).
7. THE Tier_2_Aggregate record SHALL include a `spikes` field (object or null) containing spike detection results for the aggregation window.

### Requirement 6: Spike Detection in Tier 2 Aggregates

**User Story:** As a user, I want the system to detect and record metric spikes within each 5-minute window, so that I can identify anomalous behavior without manually inspecting every data point.

#### Acceptance Criteria

1. WHEN computing a Tier_2_Aggregate, THE Metrics_History_Service SHALL calculate the average value for each numeric metric field across all samples in the 5-minute window.
2. THE Metrics_History_Service SHALL identify a sample as a spike when its value exceeds the Spike_Threshold_Multiplier (2.0) multiplied by the window average for that metric field.
3. IF one or more spikes are detected for a metric field, THEN THE Metrics_History_Service SHALL record only the single highest outlier as a spike entry with fields: `at` (number, timestamp in milliseconds) and `value` (number, the spike value).
4. IF no spike is detected for a metric field, THEN THE Metrics_History_Service SHALL omit that field from the `spikes` object.
5. THE `spikes` field SHALL be an object with metric field names as keys and `{ at: number, value: number }` as values, or null if no spikes were detected in any metric field for that window.
6. THE Spike_Threshold_Multiplier SHALL be defined as a compile-time constant (default: 2.0) and SHALL NOT be configurable via environment variable.
7. WHEN fewer than 3 samples exist in a window, THE Metrics_History_Service SHALL skip spike detection for that window (insufficient data for meaningful average).

### Requirement 7: Resilient Sampling and Aggregation

**User Story:** As a platform maintainer, I want the sampling and aggregation services to be resilient to individual failures, so that a single broken metric does not prevent all other metrics from being recorded.

#### Acceptance Criteria

1. IF a metric read from the prom-client registry throws an error, THEN THE Metrics_History_Service SHALL log the error, skip that metric, and continue sampling the remaining metrics.
2. IF a Data_Store write operation fails for a specific collection, THEN THE Metrics_History_Service SHALL log the error and continue writing to other collections.
3. THE Metrics_History_Service SHALL NOT crash or stop the sampling timer due to errors in individual metric reads or writes.
4. IF all metric reads fail in a single sampling cycle, THEN THE Metrics_History_Service SHALL log a warning and wait for the next cycle.
5. IF the aggregation cycle fails for one collection, THEN THE Metrics_History_Service SHALL log the error and continue aggregating other collections.
6. IF the Data_Store is unavailable during an aggregation cycle, THEN THE Metrics_History_Service SHALL log a warning and retry on the next 5-minute cycle.

### Requirement 8: Service Lifecycle Management

**User Story:** As a platform maintainer, I want the Metrics History Service to integrate cleanly with the Aeolus startup and shutdown sequence, so that resources are properly managed.

#### Acceptance Criteria

1. WHEN the Aeolus backend starts, THE entry point (`index.ts`) SHALL instantiate and start the Metrics_History_Service after the Data_Store and MetricsService are initialized.
2. WHEN a graceful shutdown signal is received (SIGINT/SIGTERM), THE Metrics_History_Service SHALL stop both the sampling timer and the aggregation timer, then release resources.
3. THE Metrics_History_Service SHALL expose a `dispose()` method that stops both timers and clears stored previous sample values.
4. THE Metrics_History_Service SHALL accept the Data_Store instance and MetricsService registry as constructor dependencies.
5. WHEN a graceful shutdown occurs, THE Metrics_History_Service SHALL attempt one final aggregation of any accumulated Tier_1_Sample records before stopping (best-effort, non-blocking).

### Requirement 9: Frontend Metrics Charts — Live View (Tier 1)

**User Story:** As a user, I want to see SVG sparkline charts showing the last hour of metrics at full 30-second resolution, so that I can quickly identify recent anomalies.

#### Acceptance Criteria

1. THE frontend MetricsChartsPane SHALL display SVG sparkline charts for: MQTT message rate, memory usage, event loop lag, automation execution rate, and HTTP request rate.
2. WHEN the 1-hour time range is selected, THE sparkline charts SHALL query the `_metrics:live:*` Ephemeral_Collections from the Data Store REST API.
3. THE 1-hour view SHALL display data points at full 30-second resolution (up to ~120 points per chart).
4. THE sparkline charts SHALL auto-refresh on a 30-second polling interval to stay in sync with the sampling rate.
5. WHEN no historical data is available for a metric (empty collection or Data Store disabled), THE chart area SHALL display a "No data" placeholder message.

### Requirement 10: Frontend Metrics Charts — Trend View (Tier 2)

**User Story:** As a user, I want to see trend charts showing 5-minute aggregates over longer time periods (6h, 24h, 7d, 30d), so that I can understand system behavior patterns with good resolution over days and weeks.

#### Acceptance Criteria

1. WHEN a time range of 6 hours, 24 hours, 7 days, or 30 days is selected, THE sparkline charts SHALL query the `_metrics:history:*` Permanent_Collections from the Data Store REST API.
2. THE trend charts SHALL display avg values as the primary line and peak values as a secondary indicator (e.g., a lighter line or dot markers above the avg line).
3. THE Time_Range_Selector SHALL offer the following options: 1h, 6h, 24h, 7d, 30d.
4. THE trend charts SHALL auto-refresh on a 60-second polling interval when viewing Tier 2 data.
5. WHEN fewer than 2 data points exist for the selected time range, THE chart area SHALL display a "Not enough data" placeholder message with guidance on when data will be available.
6. THE trend charts SHALL optionally highlight spike points with a distinct marker (a dot rendered in Soft Red `#EF4444`) at the spike timestamp and value.
7. WHEN a spike marker is present, THE chart SHALL display a tooltip on hover showing the spike timestamp and value.

### Requirement 11: Chart Visual Design

**User Story:** As a user, I want the metric charts to match the Aeolus design system, so that they feel cohesive with the rest of the dashboard.

#### Acceptance Criteria

1. THE sparkline charts SHALL use Aeolus Blue (`#3BA4FF`) as the primary line color for avg values.
2. THE sparkline charts SHALL use Wind Cyan (`#5CE1E6`) at 60% opacity as the secondary line color for peak values.
3. THE sparkline charts SHALL render on a dark background consistent with the card surface color (`#121821`).
4. THE sparkline charts SHALL display a subtle gradient fill below the primary line using Aeolus Blue at 20% opacity.
5. THE sparkline charts SHALL display the current (most recent) value as a prominent number above or beside the chart.
6. THE sparkline charts SHALL display the metric label in secondary text color (`#9AA6B2`) using Inter typography.
7. THE Time_Range_Selector SHALL use pill-shaped toggle buttons consistent with the existing Aeolus UI patterns.
8. THE chart layout SHALL be responsive, displaying charts in a grid that adapts from 1 column on small screens to 2-3 columns on larger screens.
9. THE sparkline charts SHALL use the same SVG rendering approach as the existing StateHistoryPane trend charts (smooth line interpolation, responsive width).
10. THE spike markers SHALL render as filled circles (radius 4px) in Soft Red (`#EF4444`) positioned at the spike data point on the chart.

### Requirement 12: Metrics Collection Visibility

**User Story:** As a user, I want system metrics collections to be hidden from the Data Store Explorer by default, so that they do not clutter my own data collections.

#### Acceptance Criteria

1. THE `_metrics:live:*` and `_metrics:history:*` collections SHALL be hidden from the main Data Store Explorer collection list by default.
2. THE Data Store Explorer SHALL provide a toggle or filter option to show system collections (those prefixed with `_metrics:`).
3. WHEN system collections are shown in the Data Store Explorer, THE UI SHALL display them with a distinct visual indicator (e.g., a system badge or muted styling) to differentiate them from user-created collections.

### Requirement 13: Configuration Validation

**User Story:** As a platform maintainer, I want invalid configuration values to be handled gracefully with sensible fallbacks, so that misconfiguration does not break the system.

#### Acceptance Criteria

1. IF the `METRICS_HISTORY_INTERVAL_MS` environment variable is set to a non-numeric or negative value, THEN THE Metrics_History_Service SHALL log a warning and use the default interval of 30,000 milliseconds.
2. IF the `METRICS_HISTORY_INTERVAL_MS` environment variable is set to a value less than 5,000 milliseconds, THEN THE Metrics_History_Service SHALL log a warning and clamp the interval to 5,000 milliseconds to prevent excessive writes.
3. IF the `METRICS_HISTORY_AGGREGATION_INTERVAL_MS` environment variable is set to a non-numeric or non-positive value, THEN THE Metrics_History_Service SHALL log a warning and use the default aggregation interval of 300,000 milliseconds.
4. IF the `METRICS_HISTORY_AGGREGATION_INTERVAL_MS` environment variable is set to a value less than 60,000 milliseconds (1 minute), THEN THE Metrics_History_Service SHALL log a warning and clamp the aggregation interval to 60,000 milliseconds.
5. IF the `METRICS_HISTORY_LIVE_RETENTION_MINUTES` environment variable is set to a non-numeric or non-positive value, THEN THE Metrics_History_Service SHALL log a warning and use the default retention of 10 minutes.
6. IF the `METRICS_HISTORY_LIVE_RETENTION_MINUTES` environment variable is set to a value less than 5 minutes, THEN THE Metrics_History_Service SHALL log a warning and clamp the retention to 5 minutes.
