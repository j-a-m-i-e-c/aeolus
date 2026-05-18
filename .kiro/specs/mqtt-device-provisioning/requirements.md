# Requirements Document

## Introduction

This feature introduces configurable MQTT security levels for the Aeolus IoT platform. The admin can switch between three security modes — Open, Shared Password, and Per-Device credentials — from the dashboard. The system manages Mosquitto's native password file format, handles broker configuration reloads, and ensures the backend's own MQTT connection remains functional across all security levels.

## Glossary

- **Provisioning_Service**: The backend service responsible for managing MQTT security levels, credentials, password file generation, and Mosquitto configuration
- **Dashboard**: The Aeolus React frontend admin interface
- **Mosquitto_Broker**: The Eclipse Mosquitto 2.x MQTT broker running in the `aeolus-mosquitto` Docker container
- **Security_Level**: One of three MQTT authentication modes: Open, Shared_Password, or Per_Device
- **Open_Mode**: Security level where `allow_anonymous true` is set and no credentials are required
- **Shared_Password_Mode**: Security level where a single username/password pair is used by all devices
- **Per_Device_Mode**: Security level where each device has a unique username/password credential
- **Password_File**: The Mosquitto-format password file at `./mosquitto/password_file` containing `username:hash` entries
- **Backend_Credential**: A dedicated MQTT credential used by the Aeolus backend service to connect to the broker
- **Mosquitto_Passwd**: The `mosquitto_passwd` command-line tool available inside the Mosquitto container, used to generate Mosquitto-compatible password hashes
- **Credential_Record**: A database entry storing a device name, username, and password hash for MQTT authentication

## Requirements

### Requirement 1: Security Level Configuration

**User Story:** As an admin, I want to view and switch between MQTT security levels from the dashboard, so that I can choose the appropriate authentication mode for my deployment.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL support exactly three Security_Level values: Open, Shared_Password, and Per_Device
2. THE Provisioning_Service SHALL persist the active Security_Level in the database
3. WHEN the platform starts for the first time, THE Provisioning_Service SHALL default the Security_Level to Open
4. WHEN the admin requests the current Security_Level via the API, THE Provisioning_Service SHALL return the active level and its associated configuration state
5. WHEN the admin changes the Security_Level, THE Provisioning_Service SHALL update the Mosquitto_Broker configuration file to match the selected level
6. WHEN the admin changes the Security_Level, THE Provisioning_Service SHALL signal the Mosquitto_Broker to reload its configuration
7. WHEN the admin switches from Per_Device_Mode to another Security_Level, THE Dashboard SHALL display a confirmation warning that existing per-device credentials will become inactive
8. WHEN the admin switches from Shared_Password_Mode to Open_Mode, THE Dashboard SHALL display a confirmation warning that the shared credential will become inactive

### Requirement 2: Open Mode Operation

**User Story:** As an admin, I want an open mode with no authentication, so that I can use MQTT freely during development and testing on trusted networks.

#### Acceptance Criteria

1. WHILE the Security_Level is Open, THE Provisioning_Service SHALL configure the Mosquitto_Broker with `allow_anonymous true`
2. WHILE the Security_Level is Open, THE Provisioning_Service SHALL remove the `password_file` directive from the Mosquitto_Broker configuration
3. WHILE the Security_Level is Open, THE Provisioning_Service SHALL connect the backend to the Mosquitto_Broker without credentials
4. WHILE the Security_Level is Open, THE Dashboard SHALL display the current mode as "Open" with a visual indicator that no authentication is active

### Requirement 3: Shared Password Mode Operation

**User Story:** As an admin, I want a single shared credential for all devices, so that I can add basic MQTT authentication without managing individual device credentials.

#### Acceptance Criteria

1. WHEN the admin activates Shared_Password_Mode, THE Provisioning_Service SHALL generate a username and a random password of at least 24 bytes encoded as base64url
2. WHEN the admin activates Shared_Password_Mode, THE Provisioning_Service SHALL write the shared credential and the Backend_Credential to the Password_File using Mosquitto-compatible hashes
3. WHILE the Security_Level is Shared_Password, THE Provisioning_Service SHALL configure the Mosquitto_Broker with `allow_anonymous false` and a `password_file` directive pointing to the Password_File
4. WHILE the Security_Level is Shared_Password, THE Dashboard SHALL display the shared username and password so the admin can copy them to device firmware
5. WHEN the admin requests credential regeneration in Shared_Password_Mode, THE Provisioning_Service SHALL generate a new password, update the Password_File, and signal the Mosquitto_Broker to reload
6. WHILE the Security_Level is Shared_Password, THE Provisioning_Service SHALL connect the backend to the Mosquitto_Broker using the Backend_Credential

### Requirement 4: Per-Device Mode Operation

**User Story:** As an admin, I want unique credentials per device, so that I can revoke access for individual devices without affecting others.

#### Acceptance Criteria

1. WHEN the admin activates Per_Device_Mode, THE Provisioning_Service SHALL configure the Mosquitto_Broker with `allow_anonymous false` and a `password_file` directive pointing to the Password_File
2. WHEN the admin creates a new device credential, THE Provisioning_Service SHALL generate a unique username derived from the device name and a random password of at least 24 bytes encoded as base64url
3. WHEN the admin creates a new device credential, THE Provisioning_Service SHALL store the Credential_Record in the database and add the entry to the Password_File using a Mosquitto-compatible hash
4. WHEN the admin creates a new device credential, THE Provisioning_Service SHALL return the username and plaintext password exactly once for the admin to copy
5. WHEN the admin revokes a device credential, THE Provisioning_Service SHALL remove the Credential_Record from the database and regenerate the Password_File without that entry
6. WHEN the admin revokes a device credential, THE Provisioning_Service SHALL signal the Mosquitto_Broker to reload the Password_File so the revoked device is disconnected
7. WHEN the admin requests the credential list, THE Provisioning_Service SHALL return all Credential_Records with device name, username, and creation timestamp, without exposing passwords or hashes
8. WHILE the Security_Level is Per_Device, THE Provisioning_Service SHALL include the Backend_Credential in the Password_File alongside device credentials

### Requirement 5: Password File Generation

**User Story:** As a developer, I want the password file to use Mosquitto's native hash format, so that the broker can authenticate devices without custom plugins.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL generate password hashes by executing the Mosquitto_Passwd tool inside the Mosquitto_Broker container via Docker exec
2. THE Provisioning_Service SHALL write the Password_File with one `username:hash` entry per line, where the hash is produced by Mosquitto_Passwd
3. WHEN the Password_File is regenerated, THE Provisioning_Service SHALL write the file atomically by writing to a temporary file and renaming it to prevent partial reads by the Mosquitto_Broker
4. IF the Mosquitto_Broker container is not running during password file generation, THEN THE Provisioning_Service SHALL log a warning and queue the operation for retry when the container becomes available
5. FOR ALL Credential_Records in the database, the Password_File SHALL contain exactly one corresponding entry per record (no duplicates, no missing entries)

### Requirement 6: Backend MQTT Connection Resilience

**User Story:** As a developer, I want the backend's MQTT connection to work regardless of the security level, so that device communication is never interrupted by security level changes.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL maintain a dedicated Backend_Credential that is included in the Password_File whenever authentication is active (Shared_Password or Per_Device modes)
2. WHEN the Security_Level changes, THE Provisioning_Service SHALL update the backend MQTT client connection parameters before signaling the Mosquitto_Broker to reload
3. WHEN the Security_Level changes to Open, THE Provisioning_Service SHALL reconfigure the backend MQTT client to connect without credentials
4. WHEN the Security_Level changes to Shared_Password or Per_Device, THE Provisioning_Service SHALL reconfigure the backend MQTT client to connect using the Backend_Credential
5. IF the backend MQTT client disconnects due to a credential mismatch after a Security_Level change, THEN THE Provisioning_Service SHALL attempt reconnection with the correct credentials within 5 seconds

### Requirement 7: Mosquitto Broker Reload

**User Story:** As a developer, I want the broker to reload its configuration after credential changes, so that new credentials take effect without restarting the container.

#### Acceptance Criteria

1. WHEN the Provisioning_Service needs to reload the Mosquitto_Broker, THE Provisioning_Service SHALL send a SIGHUP signal to the Mosquitto_Broker container via `docker kill --signal=SIGHUP aeolus-mosquitto`
2. IF the SIGHUP signal fails to deliver, THEN THE Provisioning_Service SHALL attempt to restart the Mosquitto_Broker container as a fallback
3. IF both SIGHUP and restart fail, THEN THE Provisioning_Service SHALL log an error and return a failure response to the admin indicating the broker could not be reloaded
4. WHEN a Security_Level change modifies the Mosquitto configuration file, THE Provisioning_Service SHALL reload the Mosquitto_Broker after writing both the configuration file and the Password_File

### Requirement 8: Dashboard Security Level UI

**User Story:** As an admin, I want a clear interface to manage MQTT security settings, so that I can understand and control the authentication state of my broker.

#### Acceptance Criteria

1. THE Dashboard SHALL display the current Security_Level with a distinct visual indicator for each mode (Open, Shared_Password, Per_Device)
2. THE Dashboard SHALL provide controls to switch between Security_Levels, restricted to admin users
3. WHILE the Security_Level is Shared_Password, THE Dashboard SHALL display the shared username and password with a copy-to-clipboard action
4. WHILE the Security_Level is Shared_Password, THE Dashboard SHALL provide a button to regenerate the shared password
5. WHILE the Security_Level is Per_Device, THE Dashboard SHALL display a list of all device credentials showing device name, username, and creation date
6. WHILE the Security_Level is Per_Device, THE Dashboard SHALL provide a form to create new device credentials with a device name input
7. WHILE the Security_Level is Per_Device, THE Dashboard SHALL provide a revoke action for each device credential with a confirmation prompt
8. WHEN a new credential is created, THE Dashboard SHALL display the generated password in a one-time-view dialog with a copy-to-clipboard action

### Requirement 9: API Endpoints

**User Story:** As a developer, I want RESTful API endpoints for MQTT provisioning, so that the dashboard and future integrations can manage security levels and credentials programmatically.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL expose a GET endpoint to retrieve the current Security_Level and its configuration
2. THE Provisioning_Service SHALL expose a PUT endpoint to change the Security_Level, restricted to admin users
3. THE Provisioning_Service SHALL expose a POST endpoint to regenerate the shared password in Shared_Password_Mode, restricted to admin users
4. THE Provisioning_Service SHALL expose a GET endpoint to list all device credentials in Per_Device_Mode, restricted to admin users
5. THE Provisioning_Service SHALL expose a POST endpoint to create a new device credential in Per_Device_Mode, restricted to admin users
6. THE Provisioning_Service SHALL expose a DELETE endpoint to revoke a device credential by ID in Per_Device_Mode, restricted to admin users
7. IF an endpoint is called with a Security_Level that does not match the required mode (creating a credential while in Open_Mode), THEN THE Provisioning_Service SHALL return HTTP 409 Conflict with a descriptive error message
8. THE Provisioning_Service SHALL validate all request bodies using Zod schemas and return HTTP 400 with validation details for invalid input

### Requirement 10: Data Persistence

**User Story:** As an admin, I want credentials and settings to survive restarts, so that I do not lose my MQTT security configuration.

#### Acceptance Criteria

1. THE Provisioning_Service SHALL store the active Security_Level in the SQLite database
2. THE Provisioning_Service SHALL store all Credential_Records (device name, username, password hash, creation timestamp) in the SQLite database
3. THE Provisioning_Service SHALL store the shared credential (username, password hash) in the SQLite database when in Shared_Password_Mode
4. WHEN the backend starts, THE Provisioning_Service SHALL read the persisted Security_Level and regenerate the Password_File and Mosquitto configuration to match the stored state
5. WHEN the backend starts, THE Provisioning_Service SHALL ensure the Backend_Credential exists in the database and the Password_File if authentication is active
