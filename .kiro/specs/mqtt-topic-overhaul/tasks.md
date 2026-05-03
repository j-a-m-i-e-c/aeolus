# Implementation Plan: MQTT Topic Parser Overhaul

## Overview

Replace the restrictive `parseTopic()` with a universal parser that always succeeds for any valid MQTT topic. Change `DeviceType` from a fixed union to an open string. Add `prettyPrintTopic()` for round-trip support. Update the MQTT service, device registry, connector interfaces, and documentation to match.

## Tasks

- [x] 1. Update DeviceType and core type definitions
  - [x] 1.1 Change `DeviceType` from fixed union to `string` in `src/core/types.ts`
    - Replace `export type DeviceType = "light" | "sensor" | "switch" | "climate" | "plug"` with `export type DeviceType = string`
    - Verify `Device`, `NormalizedEvent`, and other interfaces using `DeviceType` compile cleanly
    - _Requirements: 4.1_

  - [x] 1.2 Update `ConnectorMetadata.supportedDeviceTypes` in `src/connectors/connector.interface.ts`
    - Change `supportedDeviceTypes: DeviceType[]` to `supportedDeviceTypes: string[]` (or confirm it resolves via the updated `DeviceType` alias)
    - Ensure Hue and Kasa connector metadata still compiles
    - _Requirements: 4.1_

- [x] 2. Rewrite the topic parser
  - [x] 2.1 Rewrite `parseTopic()` in `src/mqtt/topic-parser.ts`
    - Export a `KNOWN_TYPES` `ReadonlySet<string>` containing: `sensor`, `switch`, `light`, `climate`, `plug`, `valve`, `pump`, `motion`, `fan`, `lock`, `cover`
    - Update `ParsedTopic` interface: change `deviceType` from `DeviceType` to `string`
    - Implement universal parsing logic:
      - Return `null` only for empty string, non-string, or all-empty-segments after splitting on `/`
      - `deviceId` = all segments joined with hyphens (casing preserved)
      - `deviceType` = first segment, lowercased
      - Name derivation: known-type with ≥2 segments → title-case remaining segments joined with spaces; unknown-type with ≥2 segments → title-case ALL segments joined with spaces; single segment → title-case that segment
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

  - [x] 2.2 Add `prettyPrintTopic()` function in `src/mqtt/topic-parser.ts`
    - Split `parsed.deviceId` on hyphens, join with `/`
    - Export the function
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 2.3 Rewrite unit tests in `src/mqtt/topic-parser.test.ts`
    - Test backward-compatible known-type topics: `sensor/kitchen/temp`, `switch/bedroom`, `light/living-room`
    - Test previously-rejected topics now succeed: `valve/irrigation/command`, `pump/well/status`, `thermostat/living`
    - Test single-segment topics: `heartbeat`, `status`
    - Test edge cases: empty string → null, non-string → null, all-empty-segments (`"///"`) → null
    - Test `prettyPrintTopic()` reconstructs expected topic strings
    - Test name derivation for known vs unknown types
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.3, 5.1, 5.3_

  - [x]* 2.4 Write property test: Universal Acceptance (Property 1)
    - **Property 1: Universal Acceptance**
    - For any non-empty string with ≥1 valid segment, `parseTopic` returns a non-null `ParsedTopic` with all fields populated as non-empty strings
    - Use a `validTopicArb` generator: 1–10 segments of `[a-zA-Z0-9_-]` joined with `/`
    - **Validates: Requirements 1.1, 1.2**

  - [x]* 2.5 Write property test: Device Type Equals First Segment — Unknown Types (Property 2)
    - **Property 2: Device Type Equals First Segment (Unknown Types)**
    - For topics whose first segment (lowercased) is NOT in `KNOWN_TYPES`, `deviceType` equals the first segment lowercased
    - **Validates: Requirements 1.3**

  - [x]* 2.6 Write property test: Device Type Equals First Segment — Known Types (Property 3)
    - **Property 3: Device Type Equals First Segment (Known Types)**
    - For topics whose first segment (lowercased) IS in `KNOWN_TYPES`, `deviceType` equals that known type string
    - **Validates: Requirements 1.4**

  - [x]* 2.7 Write property test: Deterministic Device ID (Property 4)
    - **Property 4: Deterministic Device ID from Segments**
    - For any valid topic, `deviceId` equals all segments joined with hyphens, and parsing the same topic twice produces the same `deviceId`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [x]* 2.8 Write property test: Name Derivation — Known Type Multi-Segment (Property 5)
    - **Property 5: Name Derivation — Known Type Multi-Segment**
    - For topics with ≥2 segments where the first is in `KNOWN_TYPES`, `name` equals remaining segments title-cased and joined with spaces
    - **Validates: Requirements 3.1**

  - [x]* 2.9 Write property test: Name Derivation — Unknown Type Multi-Segment (Property 6)
    - **Property 6: Name Derivation — Unknown Type Multi-Segment**
    - For topics with ≥2 segments where the first is NOT in `KNOWN_TYPES`, `name` equals ALL segments title-cased and joined with spaces
    - **Validates: Requirements 3.2**

  - [x]* 2.10 Write property test: Name Derivation — Single Segment (Property 7)
    - **Property 7: Name Derivation — Single Segment**
    - For single-segment topics, `name` equals that segment title-cased
    - **Validates: Requirements 3.3**

  - [x]* 2.11 Write property test: Parse–Print Round Trip (Property 9)
    - **Property 9: Parse–Print Round Trip**
    - For any valid topic, `parseTopic(prettyPrintTopic(parseTopic(topic)))` deeply equals `parseTopic(topic)`
    - Note: only holds for topics whose segments contain no hyphens (since `prettyPrintTopic` splits on hyphens)
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 3. Checkpoint — Parser and types
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update device registry and MQTT service
  - [x] 4.1 Expand `inferCapabilities()` in `src/core/device-registry.ts`
    - Add cases for `valve`, `pump`, `fan`, `lock`, `motion` as specified in the design
    - Keep `default: return []` for unknown types
    - _Requirements: 4.2, 4.3_

  - [x] 4.2 Update MQTT service message handler in `src/mqtt/mqtt-service.ts`
    - Verify the existing `handleMessage` logic works with the new universal parser (the null guard now only fires for truly invalid inputs)
    - No structural changes needed — the semantic meaning of the null check changes but the code is identical
    - _Requirements: 6.1, 6.2, 6.3_

  - [x]* 4.3 Write property test: Registry Accepts Any Device Type (Property 8)
    - **Property 8: Registry Accepts Any Device Type**
    - For any arbitrary non-empty string used as `deviceType` in a `NormalizedEvent`, the device registry stores the device and the retrieved device's `type` field equals the original string
    - Requires an in-memory SQLite database setup for the test
    - **Validates: Requirements 4.2, 4.3**

  - [x]* 4.4 Write integration tests for MQTT service
    - Test that previously-rejected topics (e.g., `thermostat/living`) now emit `DEVICE_STATE_CHANGE` events
    - Test that the device registry stores devices with novel type strings
    - _Requirements: 6.1, 6.2_

- [x] 5. Checkpoint — Full pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update documentation
  - [x] 6.1 Update `docs/COMPREHENSIVE_DOCUMENTATION.md`
    - Describe the single universal `parseTopic()` function
    - Remove references to the old `TYPE_MAP` gate and fixed `DeviceType` union
    - Document `KNOWN_TYPES` as a heuristic hint, not a gate
    - Document `prettyPrintTopic()`
    - _Requirements: 7.1_

  - [x] 6.2 Update `docs/MICROCONTROLLERS.md`
    - Clarify that `{type}/{location}/{metric}` is recommended but not required
    - State that any topic structure is accepted and will be parsed
    - Add examples of non-standard topics that now work (e.g., `valve/irrigation/command`, single-segment `heartbeat`)
    - _Requirements: 7.2_

  - [x] 6.3 Update `README.md`
    - Remove or revise references to the old restricted topic conventions
    - Mention that any MQTT topic is accepted
    - _Requirements: 7.3_

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `@fast-check/vitest` and `fast-check` (already in devDependencies)
- All property tests go in `src/mqtt/topic-parser.property.test.ts` (rewritten from scratch)
- Property 8 (registry test) may go in a separate file near the device registry
- Checkpoints ensure incremental validation after each major phase
- This is a clean refactor — no backward compatibility shim needed
