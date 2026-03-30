---
inclusion: auto
description: Core project context, design standards, and architecture reference for Aeolus
---

# Aeolus Project Context

## Project Overview

Aeolus is an IoT home automation platform. The project is in early development — refer to `docs/COMPREHENSIVE_DOCUMENTATION.md` for the current feature set and architecture.

## Design & Branding

When designing or modifying any frontend UI, always reference `docs/BRANDING.md` for:

- Color palette: Aeolus Blue `#3BA4FF`, Wind Cyan `#5CE1E6`, Deep Void `#0B0F14`, Graphite `#121821`, Slate `#1A2330`
- Feedback colors: Emerald `#22C55E` (success), Amber `#F59E0B` (warning), Soft Red `#EF4444` (error)
- Text hierarchy: Primary `#E6EDF3`, Secondary `#9AA6B2`, Muted `#6B7785`, Border `#2A3441`
- Typography: Inter (primary), JetBrains Mono (code/MQTT topics)
- Design pillars: clarity over decoration, bold contrast, subtle motion, data-first UI, airy spacing
- Motion: 150-250ms ease-in-out transitions, no bouncing — "feels like airflow"
- Components: cards with `#121821` bg and 12-16px border radius, thin stroke Lucide icons
- Signature gradient: `linear-gradient(135deg, #3BA4FF, #5CE1E6)` — used sparingly for hero elements

Use Tailwind theme tokens (background, surface, primary, accent) rather than raw hex values. All UI should feel calm, intelligent, precise, and data-first.

## Reference: lol-main Repository

The `lol-main` workspace folder contains a production Next.js + Express.js app (HexTekkers) that serves as an architectural reference. When building Aeolus, refer to lol-main for patterns around:

- Next.js App Router structure (`lol-main/packages/frontend/src/app/`)
- Zustand state management (`lol-main/packages/frontend/src/store/`)
- shadcn/ui component usage (`lol-main/packages/frontend/src/components/ui/`)
- Express.js API structure (`lol-main/packages/backend/src/routes/`)
- Drizzle ORM schema patterns (`lol-main/packages/backend/src/db/schema.ts`)
- AWS deployment workflows (`lol-main/.github/workflows/`)
- Comprehensive documentation approach (`lol-main/docs/COMPREHENSIVE_DOCUMENTATION.md`)

Do not copy code directly — use it as a guide for structure and patterns, adapting to Aeolus's own branding and requirements.

## Key Reference Documents

Always consult these documents when relevant:

- `docs/BRANDING.md` — Full design system, color palette, typography, component styles. Reference when designing any UI.
- `docs/COMPREHENSIVE_DOCUMENTATION.md` — Technical architecture. Update when making architectural changes.

---

**Last Updated**: 2026-03-30