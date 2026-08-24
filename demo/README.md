# Aeolus demo subsystem

The word **demo** currently covers three different concerns. This file makes the boundary explicit.

## Local showcase

`docker-compose.demo.yml` is an overlay for a normal Aeolus installation. It turns on public-demo application behaviour and runs the MQTT hardware simulator so the showcase can be exercised locally. It is **not** the internet-facing deployment definition.

## Public-demo application mode

`AEOLUS_PUBLIC_DEMO=true` activates the fail-closed anonymous showcase policy in `src/demo/`. That application code stays under `src/`.

## Hosted public showcase

`docker-compose.public-demo.yml` is the hardened standalone runtime used by `demo.aeolus.com.au`: Cloudflare Tunnel only ingress, unprivileged containers, separate simulator, active/golden SQLite split and nightly reset. `docker-compose.public-demo.build.yml` is only its local/CI build overlay. Terraform lives under `infra/public-demo/`.

## Repository cleanup target

The hosted demo was brought online before reorganising the repository. Compose relative paths, `.env` lookup, rollback, systemd and IaC docs all reference today's root paths, so moving them should be one isolated refactor after this polish release. Target:

```text
demo/
├── README.md
├── compose/
│   ├── local.yml
│   ├── public.yml
│   └── public-build.yml
├── seed/
├── operations/
└── infrastructure/terraform/
```

`docker-compose.yml` and `docker-compose.desktop.yml` should remain at root.
