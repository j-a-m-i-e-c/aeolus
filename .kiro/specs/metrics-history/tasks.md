# Implementation Plan: Metrics History

## Overview

This plan implements a two-tier metrics history system for Aeolus. The backend gains a `MetricsHistoryService` that samples prom-client registry values every 30 seconds (Tier 1) and aggregates them every 5 minutes (Tier 2) into Data Store collections. The frontend gains a `MetricsChartsPane` with SVG sparkline/trend charts, a time-range selector, and spike markers. Pure computation modules (rate-computer, aggregation, config validation) are implemented as separate units for testability.

## Tasks

- [x] 1. Implement configuration validation and pure computation modules
  - [x] 1.1 Create metrics history configuration parser (`src/metrics/metrics-history-config.ts`)
    - Implement `parseMetricsHistoryConfig(env)` pure function
    - Parse `METRICS_HISTORY_INTERVAL_MS` with default 30,000, min 5,000
    - Parse `METRICS_HISTORY_AGGREGATION_INTERVAL_MS` with default 300,000, min 60,000
    - Parse `METRICS_HISTORY_LIVE_RETENTION_MINUTES` with default 10, min 5
    - Log warnings for invalid/clamped values, use defaults for missing values
    - Export `ValidatedMetricsHistoryConfig` interface
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 1.2 Create rate computer (`src/metrics/rate-computer.ts`)
    - Implement `RateComputer` class with `computeRate(metricName, currentValue, intervalSeconds)` method
    - Store previous counter values per metric name
    - Return `null` on first sample (no previous value) or counter reset (current < previous)
    - Return `(current - previous) / intervalSeconds` for normal cases
    - Implement `reset()` to clear all stored values
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.3 Create aggregation functions (`src/metrics/aggregation.ts`)
    - Implement `computeAggregate(values: number[]): AggregateResult` — returns avg and peak
    - Implement `detectSpikes(samples, thresholdMultiplier?)` — returns spike entry or null
    - Implement `alignToWindow(timestampMs, windowMs)` — floor-aligns timestamp to window boundary
    - Spike threshold multiplier defaults to 2.0 (compile-time constant)
    - Return null for spikes when fewer than 3 samples
    - _Requirements: 4.3, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 1.4 Write property tests for configuration validation
    - Create `src/metrics/metrics-history-config.property.test.ts`
    - **Property 7: Configuration validation**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**
    - Use `arbEnvVarValue` generator for strings that may be numeric, non-numeric, negative, or valid
    - Minimum 100 iterations

  - [ ]* 1.5 Write property tests for rate computer
    - Create `src/metrics/rate-computer.property.test.ts`
    - **Property 1: Rate computation correctness**
    - **Validates: Requirements 2.2, 2.4**
    - Use `arbCounterPair` generator for `{ previous, current, intervalSeconds }`
    - Minimum 100 iterations

  - [ ]* 1.6 Write property tests for aggregation functions
    - Create `src/metrics/aggregation.property.test.ts`
    - **Property 4: Aggregation computation correctness**
    - **Validates: Requirements 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
    - **Property 5: Spike detection**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7**
    - **Property 8: Timestamp window alignment**
    - **Validates: Requirements 5.6**
    - Use `arbSampleArray` generator for timestamped value arrays
    - Minimum 100 iterations per property

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement MetricsHistoryService core
  - [x] 3.1 Create MetricsHistoryService class (`src/metrics/metrics-history-service.ts`)
    - Implement constructor accepting `MetricsHistoryDeps` (dataStore, registry, logger) and optional `Partial<MetricsHistoryConfig>`
    - Use `parseMetricsHistoryConfig` for config validation
    - Implement `start()` — starts sampling timer (setInterval) and aggregation timer
    - Implement `dispose()` — stops timers, attempts final aggregation, clears RateComputer state
    - Implement `isRunning()` — returns whether timers are active
    - Expose `sampleOnce()` and `aggregateOnce()` for testing
    - _Requirements: 1.1, 1.2, 1.5, 8.1, 8.2, 8.3, 8.4_

  - [x] 3.2 Implement Tier 1 sampling logic in MetricsHistoryService
    - In `sampleOnce()`: check DataStore enabled, read metric values from registry
    - Use RateComputer for counter metrics (MQTT messages received/published, automation execution/error, HTTP requests)
    - Write to `_metrics:live:system` with fields: `memoryUsageMb`, `eventLoopLagMs`, `uptimeSeconds`
    - Write to `_metrics:live:mqtt` with fields: `messagesReceivedRate`, `messagesPublishedRate`, `connected`
    - Write to `_metrics:live:automations` with fields: `executionRate`, `errorRate`, `activeRules`
    - Write to `_metrics:live:http` with fields: `requestRate`
    - Include `timestamp` field (epoch ms) in each record
    - Auto-create collections with 10-minute retention on first write
    - Skip writes when DataStore is disabled; resume when re-enabled
    - Wrap individual metric reads in try/catch for resilience
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.1, 7.2, 7.3, 7.4_

  - [x] 3.3 Implement Tier 2 aggregation logic in MetricsHistoryService
    - In `aggregateOnce()`: query each `_metrics:live:*` collection for the preceding 5-minute window
    - Skip aggregation if fewer than 2 samples exist (log warning)
    - Compute avg and peak using `computeAggregate()` for each numeric field
    - Run `detectSpikes()` on each field's timestamped values
    - Write `_metrics:history:system` with fields: `avgMemoryMb`, `peakMemoryMb`, `avgEventLoopLagMs`, `peakEventLoopLagMs`, `spikes`
    - Write `_metrics:history:mqtt` with fields: `avgMessagesPerSec`, `peakMessagesPerSec`, `connectedPct`, `spikes`
    - Write `_metrics:history:automations` with fields: `totalExecutions`, `totalErrors`, `avgActiveRules`, `spikes`
    - Write `_metrics:history:http` with fields: `totalRequests`, `avgResponseMs`, `spikes`
    - Set timestamp to aligned 5-minute window boundary
    - Auto-create history collections with no retention (permanent)
    - Wrap per-collection logic in try/catch for resilience
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.5, 7.6_

  - [ ]* 3.4 Write property tests for MetricsHistoryService
    - Create `src/metrics/metrics-history-service.property.test.ts`
    - **Property 2: Tier 1 record structure and routing**
    - **Validates: Requirements 1.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    - **Property 3: DataStore-disabled guard**
    - **Validates: Requirements 1.3**
    - **Property 6: Sampling resilience**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**
    - Use `arbMetricRegistryState` generator for valid metric registry states
    - Minimum 100 iterations per property

  - [ ]* 3.5 Write unit tests for MetricsHistoryService
    - Create `src/metrics/metrics-history-service.test.ts`
    - Test service start/stop lifecycle (timers created and cleared)
    - Test DataStore enabled → disabled → enabled transitions
    - Test first sample produces no rate (only baseline stored)
    - Test counter reset detection with specific values
    - Test aggregation skipped when < 2 samples
    - Test final aggregation on dispose
    - Test resilience: single metric read failure doesn't stop others
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.3, 2.4, 4.6, 7.1, 7.2, 7.3, 8.2, 8.3, 8.5_

- [x] 4. Wire MetricsHistoryService into application lifecycle
  - [x] 4.1 Integrate MetricsHistoryService into `src/index.ts`
    - Import and instantiate MetricsHistoryService after DataStore and MetricsService are initialized
    - Pass DataStore instance, prom-client default registry, and logger as dependencies
    - Call `start()` after instantiation
    - Add `metricsHistoryService.dispose()` to the graceful shutdown sequence (before DataStore dispose)
    - _Requirements: 8.1, 8.2, 8.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement frontend metrics history store and components
  - [x] 6.1 Create metrics history Zustand store (`frontend/src/store/metrics-history-store.ts`)
    - Implement `MetricsHistoryState` interface with `timeRange`, `chartData`, `loading`, `error`
    - Implement `setTimeRange(range)` — updates range and triggers fetch
    - Implement `fetchChartData()` — queries appropriate collections based on time range
    - For "1h" range: query `_metrics:live:*` collections
    - For "6h"/"24h"/"7d"/"30d" ranges: query `_metrics:history:*` collections
    - Implement `startPolling()` — 30s interval for 1h view, 60s for longer views
    - Implement `stopPolling()` — clears polling interval
    - Handle loading, error, and empty data states
    - _Requirements: 9.2, 9.4, 10.1, 10.4_

  - [x] 6.2 Create TimeRangeSelector component (`frontend/src/components/TimeRangeSelector.tsx`)
    - Render pill-shaped toggle buttons for: 1h, 6h, 24h, 7d, 30d
    - Highlight active selection with Aeolus Blue
    - Call `onChange` callback when selection changes
    - Style consistent with existing Aeolus UI patterns
    - _Requirements: 10.3, 11.7_

  - [x] 6.3 Create MetricSparkline component (`frontend/src/components/MetricSparkline.tsx`)
    - Render SVG sparkline chart with smooth line interpolation (reuse StateHistoryChart patterns)
    - Primary line in Aeolus Blue (`#3BA4FF`) for avg values
    - Secondary line in Wind Cyan (`#5CE1E6`) at 60% opacity for peak values
    - Gradient fill below primary line (Aeolus Blue at 20% opacity)
    - Render spike markers as filled circles (radius 4px) in Soft Red (`#EF4444`)
    - Display current value prominently above/beside chart
    - Display metric label in secondary text color (`#9AA6B2`)
    - Show tooltip on spike marker hover with timestamp and value
    - Handle empty data with "No data" placeholder
    - Handle < 2 points with "Not enough data" message
    - Dark background consistent with card surface (`#121821`)
    - _Requirements: 9.5, 10.2, 10.5, 10.6, 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.10_

  - [x] 6.4 Create MetricsChartsPane component (`frontend/src/components/panes/MetricsChartsPane.tsx`)
    - Display sparkline charts for: MQTT message rate, memory usage, event loop lag, automation execution rate, HTTP request rate
    - Include TimeRangeSelector at the top
    - Responsive grid layout: 1 column (small) → 2-3 columns (large)
    - Auto-start/stop polling on mount/unmount via metrics-history-store
    - Register in the pane registry
    - Show "Metrics history requires Data Store" when DataStore is disabled
    - _Requirements: 9.1, 9.3, 11.8_

  - [ ]* 6.5 Write unit tests for frontend components
    - Create `frontend/src/components/MetricSparkline.test.tsx` — renders SVG, handles empty data, shows spike markers
    - Create `frontend/src/components/TimeRangeSelector.test.tsx` — renders all options, calls onChange
    - Create `frontend/src/store/metrics-history-store.test.ts` — fetches correct endpoints per time range, polling lifecycle
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 10.1, 10.3, 10.4_

- [x] 7. Hide system collections from Data Store Explorer
  - [x] 7.1 Update Data Store Explorer to hide `_metrics:*` collections by default
    - Filter out collections with `_metrics:` prefix from the main collection list
    - Add a toggle/filter option to show system collections
    - When shown, display system collections with a distinct visual indicator (system badge or muted styling)
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (8 total)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation uses TypeScript
- No new runtime dependencies needed — uses existing `prom-client`, `DataStore`, and `pino`
- No new dev dependencies needed — `fast-check`, `vitest`, and `@fast-check/vitest` are already available
- The MetricsHistoryService must be instantiated AFTER both DataStore and MetricsService in `index.ts`
- The MetricsHistoryService must be disposed BEFORE DataStore during shutdown
- `_metrics:live:*` collections use 10-minute retention (auto-pruned by DataStore)
- `_metrics:history:*` collections have no retention (permanent storage)
- Spike threshold multiplier (2.0) is a compile-time constant, not configurable via env var

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.1"] },
    { "id": 5, "tasks": ["6.1", "6.2", "7.1"] },
    { "id": 6, "tasks": ["6.3"] },
    { "id": 7, "tasks": ["6.4"] },
    { "id": 8, "tasks": ["6.5"] }
  ]
}
```
