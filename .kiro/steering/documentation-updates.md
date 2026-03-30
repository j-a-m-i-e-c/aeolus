---
inclusion: auto
description: Rules for keeping COMPREHENSIVE_DOCUMENTATION.md up to date when making architectural changes
---

# Documentation Update Rules

## COMPREHENSIVE_DOCUMENTATION.md

When making changes to the codebase that affect any of the following areas, update `docs/COMPREHENSIVE_DOCUMENTATION.md` to reflect the changes:

- New or modified API endpoints
- Database schema changes (new tables, columns, indexes)
- Authentication or authorization changes
- New environment variables or secrets
- Infrastructure changes (AWS services, CloudFormation)
- Deployment workflow changes
- New frontend components or pages that represent major features
- Security architecture changes
- Cost-impacting changes

Also update the `Last Updated` date and bump the version at the bottom of the file when making documentation changes.

Do not update the documentation for minor refactors, bug fixes, or internal code changes that don't affect the external behavior or architecture.

## ROADMAP.md

When completing a feature that is listed in `docs/ROADMAP.md`, mark it as done or remove it. When adding new features that represent future work or planned enhancements, add them to the appropriate section in the roadmap.

## BRANDING.md

When designing or modifying UI components, always reference `docs/BRANDING.md` for:

- Color palette (Aeolus Blue #3BA4FF, Wind Cyan #5CE1E6, Deep Void #0B0F14, Graphite #121821, Slate #1A2330)
- The design pillars: clarity over decoration, bold contrast, subtle motion, data-first UI, airy spacing
- Typography: Inter (primary), JetBrains Mono (code/MQTT topics)
- Brand personality: calm, intelligent, precise, invisible but powerful
- Motion: smooth 150-250ms ease-in-out transitions, no bouncing

All new UI should feel consistent with the Aeolus aesthetic. Use the Tailwind theme tokens (background, surface, primary, accent) rather than raw hex values.