# Requirements Document

## Introduction

Overhaul the MQTT topic parser in Aeolus to replace the current restrictive, hardcoded `TYPE_MAP` approach with a single universal `parseTopic()` function that handles **any** valid MQTT topic. The current parser (`src/mqtt/topic-parser.ts`) only recognizes topics starting with `sensor`, `switch`, `motion`, or `light`, silently dropping all other messages. This refactor removes that gate entirely. One parser, no registry, no fallback layers — just a clean function that always succeeds for any valid topic. The `{type}/{location}/{metric}` convention remains as a recommended pattern for users, but the parser itself is topic-structure-agnostic. `DeviceType` becomes an open string so the system never rejects a device category it hasn't seen before.

## Glossary

- **Topic_Parser**: The single `parseTopic()` function that accepts any MQTT topic string and returns structured device metadata.
- **Parsed_Topic**: The structured result of parsing an MQTT topic, containing a device ID, device type, and human-readable name.
- **Device_Type**: An open string representing a device category (e.g., `"sensor"`, `"valve"`, `"pump"`). Not restricted to a fixed union or enum.
- **Known_Type_List**: A set of commonly recognized device type strings (e.g., `"sensor"`, `"switch"`, `"light"`, `"climate"`, `"plug"`, `"valve"`, `"pump"`) used as a heuristic hint — not as a gate.
- **MQTT_Service**: The service responsible for connecting to the MQTT broker, receiving messages, and dispatching parsed events.
- **Normalized_Event**: The internal event object emitted after a topic is parsed and a payload is decoded, consumed by the device registry and automation engine.
- **Pretty_Printer**: A function that reconstructs a canonical MQTT topic string from a Parsed_Topic.
- **Documentation**: The project documentation files (`docs/COMPREHENSIVE_DOCUMENTATION.md`, `README.md`, `docs/MICROCONTROLLERS.md`) that describe the system architecture and topic conventions.

## Requirements

### Requirement 1: Universal Topic Acceptance

**User Story:** As a home automation user, I want every MQTT message to be processed regardless of its topic structure, so that I can integrate any device or service without modifying the platform code.

#### Acceptance Criteria

1. WHEN a message arrives on any valid MQTT topic with one or more segments, THE Topic_Parser SHALL produce a Parsed_Topic containing a device ID, device type, and human-readable name.
2. THE Topic_Parser SHALL never return null for a syntactically valid, non-empty MQTT topic string.
3. WHEN a message arrives on a topic with segments that do not match any entry in the Known_Type_List, THE Topic_Parser SHALL use the first segment as the device type verbatim.
4. WHEN a message arrives on a topic where the first segment matches an entry in the Known_Type_List, THE Topic_Parser SHALL use the matched known type string as the device type.

### Requirement 2: Deterministic Device ID Generation

**User Story:** As a system operator, I want device IDs to be deterministic and derived from the topic, so that the same topic always maps to the same device and state updates are consistent.

#### Acceptance Criteria

1. FOR ALL valid MQTT topics, THE Topic_Parser SHALL produce the same device ID when the same topic string is parsed multiple times.
2. THE Topic_Parser SHALL derive the device ID by joining all topic segments with hyphens.
3. THE Topic_Parser SHALL preserve casing when generating device IDs, so that two topics differing only in casing produce distinct device IDs.
4. THE Topic_Parser SHALL include no random or time-based components in the device ID.

### Requirement 3: Human-Readable Name Derivation

**User Story:** As a dashboard user, I want devices to have readable names derived from their topic, so that I can identify devices without manual configuration.

#### Acceptance Criteria

1. WHEN a topic has two or more segments and the first segment matches the Known_Type_List, THE Topic_Parser SHALL derive the name from the remaining segments by title-casing each segment and joining them with spaces.
2. WHEN a topic has two or more segments and the first segment does not match the Known_Type_List, THE Topic_Parser SHALL derive the name from all segments by title-casing each segment and joining them with spaces.
3. WHEN a topic has exactly one segment, THE Topic_Parser SHALL use the title-cased segment as the name.

### Requirement 4: Open Device Type System

**User Story:** As a user with diverse IoT devices, I want the platform to accept any device type string, so that I am not limited to a predefined set of categories.

#### Acceptance Criteria

1. THE Device_Type SHALL be represented as a string type rather than a fixed union or enum.
2. WHEN a Parsed_Topic contains a device type not previously seen, THE device registry SHALL accept and store the device without error.
3. WHEN a device is created with a previously unseen device type, THE device registry SHALL use the device type string as-is in the stored Device record.

### Requirement 5: Topic Pretty-Printing and Round-Trip

**User Story:** As a developer, I want to reconstruct a topic string from a Parsed_Topic, so that I can serialize and debug parsed results reliably.

#### Acceptance Criteria

1. THE Pretty_Printer SHALL format a Parsed_Topic back into a valid MQTT topic string using forward-slash-separated segments.
2. FOR ALL valid MQTT topics, parsing then pretty-printing then parsing again SHALL produce a Parsed_Topic equivalent to the original parse result (round-trip property).
3. THE Pretty_Printer SHALL preserve the original segment order and casing.

### Requirement 6: Backward-Compatible MQTT Service Integration

**User Story:** As a developer, I want the refactored parser to integrate seamlessly with the existing MQTT service, so that no other system components need changes beyond the parser and type definitions.

#### Acceptance Criteria

1. WHEN the MQTT_Service receives a message, THE MQTT_Service SHALL call the Topic_Parser and emit a Normalized_Event for every valid topic (no messages silently dropped due to unrecognized topic structure).
2. THE Normalized_Event SHALL use the open string Device_Type from the Parsed_Topic.
3. WHEN the Topic_Parser is called with an empty string or a non-string value, THE Topic_Parser SHALL return null.

### Requirement 7: Documentation Updates

**User Story:** As a developer or user reading the project documentation, I want all docs to reflect the new universal topic parser, so that I am not misled by references to the old restricted TYPE_MAP or fixed topic format.

#### Acceptance Criteria

1. WHEN the implementation is complete, THE Documentation SHALL update `docs/COMPREHENSIVE_DOCUMENTATION.md` to describe the single universal Topic_Parser, remove references to the old TYPE_MAP gate, and clarify that any MQTT topic is accepted.
2. WHEN the implementation is complete, THE Documentation SHALL update `docs/MICROCONTROLLERS.md` to clarify that the `{type}/{location}/{metric}` convention is recommended but not required, and that any topic structure is accepted.
3. WHEN the implementation is complete, THE Documentation SHALL update `README.md` to remove or revise any references to the old restricted topic conventions.
