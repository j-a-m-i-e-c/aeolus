# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest main | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability in Aeolus, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer at [security contact — use GitHub private vulnerability reporting]
3. Or use [GitHub's private vulnerability reporting](https://github.com/j-a-m-i-e-c/aeolus/security/advisories/new)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix.

## Security Design

Aeolus is designed for local network deployment:

- **No cloud dependency** — all data stays on your LAN
- **Read-only system router** — no host control via HTTP
- **No Docker socket mount** — no container escape path
- **V8 sandbox isolation** — user scripts run in isolated-vm with 32MB memory limit and 5s timeout
- **JWT authentication** — short-lived tokens (15min) with httpOnly refresh cookies
- **bcrypt password hashing** — cost factor 12
- **Rate-limited login** — 5 attempts/min per IP
- **Minimal production image** — no git, docker-cli, or build tools
