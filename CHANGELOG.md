# Changelog

All notable changes to Aeolus are documented here. This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Custom UI component API rename — `aeolus.read()`, `aeolus.save()`, `aeolus.fire()`, `aeolus.control()`, `aeolus.publish()`, `aeolus.saveAndFire()`
- `Makefile` with common dev/deploy commands (`make deploy`, `make logs`, `make clean`)
- Update availability check via GitHub API (shown in System page header)
- Build-time version detection (git commit hash baked into Docker image)
- `GET /api/devices/:id/actions` — action catalog discovery endpoint
- `devices.actionAll()` — bulk device action execution in automation sandbox
- Pre-flight action validation (type + param schema checks)
- MQTT command publishing from automations (topic auto-derived)
- `ActionResult` structured responses for all device actions

### Changed
- System routes are now GET-only (read-only diagnostics) — all POST control endpoints removed
- Docker socket mount removed from docker-compose.yml
- docker-ce-cli and git removed from production Docker image
- Services Framework removed — automation engine handles cron/triggers natively

### Security
- Read-only system router eliminates host control via HTTP
- No Docker socket access in backend container
- Minimal production image (no build tools, git, or Docker CLI)

### Fixed
- Docker healthcheck 401 (HEAD /api/health now allowed as public route)
- System endpoints made public (no auth needed for read-only diagnostics)
- esbuild restored as production dependency (runtime transpiler requirement)
