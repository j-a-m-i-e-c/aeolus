# Changelog

Aeolus follows semantic versioning for published releases. Until the first stable release, interfaces may still change as the platform is hardened.

## Unreleased

### Security and reliability

* WebSocket access tokens are sent only in the first authenticated message and are no longer accepted from query strings.
* Refresh cookie security can be selected explicitly or left in automatic mode for local HTTP versus public HTTPS deployments.
* High rate device state now uses keep latest execution coalescing while discrete Automation Events remain separate and are never coalesced.
* Device Registry state persistence is batched and flushed transactionally, including during graceful shutdown.
* The dashboard host CSP no longer requires inline script execution.
* Version information is local only until an administrator explicitly asks Aeolus to check GitHub releases.
* The Mosquitto reload watcher is built with its dependencies instead of installing packages when the stack starts.

### Operations

* Raspberry Pi installs can pin `AEOLUS_REF` to a release tag or commit.
* A repeatable MQTT load generator is available under `scripts/bench/` for Pi testing.
* Release and multi architecture CI validation has been expanded.
