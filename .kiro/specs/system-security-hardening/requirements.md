# Requirements Document

## Introduction

This document defines the requirements for the System Security Hardening feature of the Aeolus IoT platform. The feature removes all dangerous system control endpoints that grant root-level host access via the Docker socket, eliminates the Docker socket mount and unnecessary packages from the production image, simplifies the version endpoint to use build-time environment variables, and converts the frontend System page to a purely read-only interface. The security surface is reduced from "full root on host" to "read-only OS metrics via Node.js `os` module and a single `df` command".

## Glossary

- **System_Router**: The Express.js router module that handles all `/api/system/*` endpoints
- **Backend_Container**: The Docker container running the Aeolus Express.js application
- **Production_Image**: The Docker image built from the Dockerfile for production deployment
- **Compose_Configuration**: The `docker-compose.yml` file that orchestrates Aeolus services
- **System_Page**: The React frontend page displaying system diagnostics and health information
- **Version_Endpoint**: The `GET /api/system/version` route that returns build version information
- **Diagnostics_Endpoint**: The `GET /api/system` route that returns host metrics
- **Logs_Endpoint**: The `GET /api/system/logs` route that returns recent application logs
- **Build_Args**: Docker build arguments (`BUILD_COMMIT`, `BUILD_DATE`) passed at image build time

## Requirements

### Requirement 1: Remove Dangerous System Control Endpoints

**User Story:** As a platform operator, I want all dangerous system control endpoints removed, so that attackers who compromise the web UI cannot shut down, reboot, or modify the host system.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/api/system/update`, THE System_Router SHALL return a 404 response
2. WHEN a client sends a POST request to `/api/system/shutdown`, THE System_Router SHALL return a 404 response
3. WHEN a client sends a POST request to `/api/system/reboot`, THE System_Router SHALL return a 404 response
4. WHEN a client sends a POST request to `/api/system/docker-prune`, THE System_Router SHALL return a 404 response
5. THE System_Router SHALL register only GET method route handlers and SHALL NOT register any POST, PUT, DELETE, or PATCH route handlers
6. WHEN a client sends a non-GET request to any `/api/system/*` path, THE System_Router SHALL return a 404 response with no operation executed on the host

### Requirement 2: Eliminate Privileged Process Spawning

**User Story:** As a platform operator, I want no privileged child processes spawned from the backend, so that the application cannot be exploited for container escape or host command execution.

#### Acceptance Criteria

1. THE System_Router source code SHALL NOT import `spawn`, `spawnSync`, `exec`, `execFile`, `execFileSync`, or `fork` from `child_process`
2. THE System_Router SHALL limit `execSync` usage to the single invocation `execSync("df -B1 / | tail -1", { encoding: "utf-8", timeout: 5000 })`
3. THE System_Router SHALL NOT execute any command containing `docker`, `git`, `nsenter`, `chroot`, or `--pid=host`
4. IF the `execSync` invocation of `df -B1 / | tail -1` throws an error, THEN THE System_Router SHALL return `null` for the disk usage result without propagating the error to the caller

### Requirement 3: Remove Docker Socket Access

**User Story:** As a platform operator, I want the Docker socket removed from the container, so that container escape via the Docker daemon is impossible.

#### Acceptance Criteria

1. THE Compose_Configuration SHALL NOT mount `/var/run/docker.sock` as a volume on the Backend_Container
2. THE Compose_Configuration SHALL NOT mount any host directory as a bind mount on the Backend_Container
3. THE Compose_Configuration SHALL NOT define the `AEOLUS_PROJECT_DIR` environment variable for the Backend_Container
4. THE Compose_Configuration SHALL NOT define a `DOCKER_HOST` environment variable for the Backend_Container
5. THE Compose_Configuration SHALL define only the `backend_data` named volume mount on the Backend_Container

### Requirement 4: Remove Unnecessary Packages from Production Image

**User Story:** As a platform operator, I want docker-ce-cli and git removed from the production image, so that even if an attacker gains shell access inside the container, they cannot use Docker or git to escalate privileges.

#### Acceptance Criteria

1. THE Production_Image SHALL NOT install the `docker-ce-cli` package in the production stage
2. THE Production_Image SHALL NOT install `git` in the production stage
3. THE Production_Image SHALL NOT contain Docker apt repository entries in `/etc/apt/sources.list.d/` or Docker GPG keys in `/etc/apt/keyrings/`
4. THE Production_Image SHALL NOT contain a `git config --global` directive in the Dockerfile production stage
5. WHEN the Production_Image is built, THE Production_Image SHALL NOT contain the `docker` binary or the `git` binary on the filesystem

### Requirement 5: Build-Time Version Baking

**User Story:** As a platform operator, I want version information baked into the image at build time, so that the backend never needs git or network access to report its version.

#### Acceptance Criteria

1. THE Production_Image SHALL accept `BUILD_COMMIT` and `BUILD_DATE` as build arguments with empty-string defaults
2. THE Production_Image SHALL expose `BUILD_COMMIT` and `BUILD_DATE` as environment variables in the running container
3. WHEN the Version_Endpoint receives a GET request, THE System_Router SHALL return an HTTP 200 JSON response containing the value of `process.env.BUILD_COMMIT` as the `commit` field
4. WHEN the Version_Endpoint receives a GET request, THE System_Router SHALL return the value of `process.env.BUILD_DATE` as the `buildDate` field in the same JSON response
5. IF `BUILD_COMMIT` is not set or is an empty string, THEN THE Version_Endpoint SHALL return `"unknown"` as the `commit` field
6. IF `BUILD_DATE` is not set or is an empty string, THEN THE Version_Endpoint SHALL return `"unknown"` as the `buildDate` field
7. THE Version_Endpoint SHALL NOT spawn any child processes or make network calls
8. WHEN `BUILD_DATE` is provided, THE Production_Image SHALL accept it in ISO 8601 format (e.g., `2024-01-15T10:30:00Z`)

### Requirement 6: Read-Only System Diagnostics

**User Story:** As a user, I want to view system health metrics, so that I can monitor the platform without needing SSH access to the host.

#### Acceptance Criteria

1. WHEN the Diagnostics_Endpoint receives a GET request, THE System_Router SHALL return a JSON response containing: `hostname` (string), `platform` (string), `arch` (string), `cpuModel` (string), `cpuCores` (number), `cpuTemp` (number in degrees Celsius or null), `loadAvg` (object with `1m`, `5m`, `15m` numeric fields), `memory` (object with `total`, `used`, `free` in bytes and `usagePercent` as 0–100), `disk` (object with `total`, `used`, `free` in bytes and `usagePercent` as 0–100, or null), `network` (array of objects each with `name` and `address` strings), and `uptime` (number in seconds)
2. IF the thermal zone file is not readable, THEN THE Diagnostics_Endpoint SHALL return `null` for the `cpuTemp` field
3. IF the `df` command fails, THEN THE Diagnostics_Endpoint SHALL return `null` for the `disk` field
4. THE Diagnostics_Endpoint SHALL NOT include any Docker-related information in the response
5. THE Diagnostics_Endpoint SHALL return only non-negative numeric values for all metric fields, with `memory.usagePercent` and `disk.usagePercent` clamped to the range 0–100

### Requirement 7: Application Log Retrieval

**User Story:** As a user, I want to view recent application logs filtered by level, so that I can diagnose issues without accessing the container shell.

#### Acceptance Criteria

1. WHEN the Logs_Endpoint receives a GET request with a `count` parameter containing a valid integer between 1 and 200, THE System_Router SHALL return at most that number of log entries ordered from most recent to oldest
2. WHEN the Logs_Endpoint receives a GET request with a `level` parameter matching one of the valid log levels (trace, debug, info, warn, error, fatal), THE System_Router SHALL return only log entries whose levelLabel matches the specified level
3. WHEN the Logs_Endpoint receives a GET request without parameters, THE System_Router SHALL return the most recent 100 log entries ordered from most recent to oldest
4. IF the `count` parameter is non-numeric, less than 1, or greater than 200, THEN THE System_Router SHALL treat the count as 100
5. IF the `level` parameter does not match any valid log level, THEN THE System_Router SHALL return an empty array

### Requirement 8: Frontend System Page Simplification

**User Story:** As a user, I want the System page to display diagnostics without dangerous action buttons, so that there is no risk of accidentally or maliciously triggering host-level operations from the UI.

#### Acceptance Criteria

1. THE System_Page SHALL NOT render Update, Reboot, or Shutdown buttons or any interactive elements that trigger POST, PUT, PATCH, or DELETE requests
2. THE System_Page SHALL NOT render a Docker disk breakdown overlay or prune button
3. THE System_Page SHALL display CPU, Memory, Disk, Temperature, Network, and Uptime diagnostic cards each showing current values retrieved from the Diagnostics_Endpoint
4. THE System_Page SHALL display build version information (commit and build date) retrieved from the Version_Endpoint within the page header or a dedicated info section
5. THE System_Page SHALL make only GET requests to the backend
6. THE System_Page SHALL retain the health summary bar showing device count, automation count, uptime, and MQTT status
7. THE System_Page SHALL retain the log viewer component with level filtering and manual refresh capability
8. IF the Diagnostics_Endpoint returns null for an optional field (cpuTemp or disk), THEN THE System_Page SHALL display a "Not available" placeholder in the corresponding diagnostic card
9. IF the Diagnostics_Endpoint request fails, THEN THE System_Page SHALL display an error state indicating that system information could not be loaded
