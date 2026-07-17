# Aeolus documentation

This directory is organised by audience and task. Start with the short documents, then move into the reference material when you need implementation detail.

## Start here

| Document | Best for |
|---|---|
| [What is Aeolus?](WHAT_IS_AEOLUS.md) | Grant reviewers, designers, employers and informed non-engineers |
| [Why Aeolus?](WHY_AEOLUS.md) | Developers and technical reviewers evaluating the platform model |
| [Project README](../README.md) | Setup, feature overview and repository navigation |
| [Roadmap](ROADMAP.md) | Current priorities and longer-term directions |

## Guides

| Document | Purpose |
|---|---|
| [How-to guides](how-to/README.md) | Short steps for common administration tasks |
| [Microcontrollers](MICROCONTROLLERS.md) | Connecting ESP32 and Arduino devices over MQTT |
| [Connector developer guide](../src/connectors/README.md) | Building a new local integration |
| [Production deployment](production-deployment.md) | HTTPS, firewalling, backups, monitoring and upgrades |
| [Testing](TESTING.md) | Test layers, coverage and CI |
| [Contributing](../CONTRIBUTING.md) | Development workflow and pull requests |
| [Branding](BRANDING.md) | Visual design system |
| [Media capture plan](MEDIA_CAPTURE_PLAN.md) | Screenshots and GIFs needed for the public docs |

## Technical reference

The old single-file comprehensive document has been split into smaller references:

| Reference | Covers |
|---|---|
| [Reference index](reference/README.md) | Map of the technical reference |
| [Architecture](reference/architecture.md) | Runtime layers, events, devices, APIs and process boundaries |
| [Automation runtime](reference/automations.md) | Logic, triggers, sandbox, state, custom UI and command results |
| [Connectors](reference/connectors.md) | Connector module contract and lifecycle |
| [Data and storage](reference/data-and-storage.md) | SQLite, migrations, state history and Data Store |
| [API and WebSocket](reference/api.md) | Current HTTP routes and real-time protocol |
| [Dashboard](reference/dashboard.md) | Pages, panes, stores and the custom UI host |
| [Operations](reference/operations.md) | Configuration, Docker, logging, metrics, CI and failure handling |

## Security reference

| Document | Covers |
|---|---|
| [Security index](security/README.md) | Security model and navigation |
| [Human authentication](security/authentication.md) | First-run setup, login, users and groups |
| [Permissions](security/permissions.md) | Admin role and tab permission model |
| [Tokens and API access](security/tokens-and-api.md) | Access tokens, refresh cookies, public endpoints and WebSockets |
| [MQTT security](security/mqtt.md) | Open, shared and per-device broker modes |
| [Troubleshooting](security/troubleshooting.md) | Login, token, WebSocket and MQTT recovery |

## Documentation maintenance

The code and tests are the final authority for runtime behaviour. Documentation should describe stable contracts and user-visible behaviour rather than mirror every class or file.

When a change affects behaviour:

1. update the narrowest relevant reference;
2. update the README only when first-run setup or a major public capability changes;
3. update WHY or WHAT only when the product explanation changes;
4. add or update tests alongside the implementation;
5. avoid copying the same detailed explanation into several files.
