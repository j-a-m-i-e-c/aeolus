---
inclusion: auto
description: Rules for keeping COMPREHENSIVE_DOCUMENTATION.md up to date when making architectural changes
---

# Documentation Update Rules

## CRITICAL: Keep COMPREHENSIVE_DOCUMENTATION.md in Sync

`docs/COMPREHENSIVE_DOCUMENTATION.md` is the **single source of truth** for the entire Aeolus platform. It MUST stay in sync with the codebase at all times.

**After EVERY significant change, update the comprehensive docs.** This is not optional — it's part of the definition of done for any feature or fix that changes behavior, adds endpoints, modifies the schema, or introduces new components.

### When to update

Update the documentation on EVERY commit that does any of the following:

**Backend changes:**
- New or modified API endpoint (add to both the detailed API Reference section AND the Additional API Endpoints table)
- New route file created (add to Project Structure tree)
- Database schema change (new table, column, index — update the SQLite Schema section)
- New environment variable or removal of one (update the Environment Variables table AND .env.example)
- New core service or module (add to Core Components section with description)
- Changes to MQTT topic handling or event bus events
- New integration added (add to Core Components and update Architecture diagram if needed)
- Error handling changes (update the Error Handling table)
- Changes to Docker Compose services, ports, or volumes

**Frontend changes:**
- New page added to the dashboard (add to Dashboard Features with its own subsection listing all features)
- New component that adds user-visible functionality (add to the relevant page subsection in Dashboard Features)
- New UI control or interaction pattern (e.g. colour picker, drag-to-reorder, debounced slider — document it)
- Changes to state management (new Zustand store fields, new WebSocket message types)
- New component file created (add to Project Structure tree)

**Infrastructure changes:**
- New script added (add to Project Structure tree)
- Deployment workflow changes
- Docker configuration changes
- New Kiro hooks or steering files

**General:**
- Design decisions worth documenting (add to Design Decisions section)
- New future enhancement ideas discussed (add to Future Enhancements section)

### What to update

For each change, check and update ALL of these sections as applicable:

1. **Project Structure** — Every new file should appear in the tree
2. **Core Components** — New backend services get their own subsection
3. **API Reference** — Detailed endpoint docs for major endpoints
4. **Additional API Endpoints** — Summary table for all endpoints
5. **Dashboard Features** — Organized by page, every user-visible feature listed
6. **Data Models** — Schema changes, new interfaces
7. **Environment Variables** — Table must match .env.example exactly
8. **Error Handling** — New error scenarios
9. **Design Decisions** — Architectural choices and rationale
10. **Future Enhancements** — Planned features, ideas from conversations
11. **Last Updated date** — Always update to today's date
12. **Version** — Bump patch for fixes, minor for features, major for breaking changes

### What NOT to update

- Pure refactors that don't change external behavior
- Code style or formatting changes
- Test-only changes (unless adding a new testing pattern worth documenting)
- Dependency version bumps with no API changes

## README.md

The README is the public-facing quick start guide. Update it when:

- Setup instructions change (new prerequisites, different commands)
- New major feature is added that should be highlighted (keep it concise — link to comprehensive docs for details)
- API endpoints table changes
- Deployment instructions change
- Integration setup flow changes (e.g. Hue moved from env vars to self-service)

The README should always reflect the current recommended way to set up and use Aeolus. Remove outdated instructions immediately.

## BRANDING.md

When designing or modifying UI components, always reference `docs/BRANDING.md` for:

- Color palette (Aeolus Blue #3BA4FF, Wind Cyan #5CE1E6, Deep Void #0B0F14, Graphite #121821, Slate #1A2330)
- The design pillars: clarity over decoration, bold contrast, subtle motion, data-first UI, airy spacing
- Typography: Inter (primary), JetBrains Mono (code/MQTT topics)
- Brand personality: calm, intelligent, precise, invisible but powerful
- Motion: smooth 150-250ms ease-in-out transitions, no bouncing

All new UI should feel consistent with the Aeolus aesthetic. Use the Tailwind theme tokens (background, surface, primary, accent) rather than raw hex values.
