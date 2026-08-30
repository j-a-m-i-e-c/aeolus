# Showcase Automation Project source architecture audit — 2026-08-30

## Scope

All 26 seeded Automation Projects across Agriculture, Wildlife, Research Vessel, Underground Mining, Escape Room, Stage & Show, Off-Grid Bunker and Live Space were reviewed as public-facing source, not just as runtime code.

The review asked one question: when a visitor opens **Logic**, **UI**, then **Files**, does the project demonstrate Aeolus' intended authoring model clearly?

## Findings before the refactor

- 20 of 26 projects contained only the two entry files (`logic/index.ts` and `ui/index.tsx`).
- Only 4 projects had extracted Logic modules.
- Only 3 projects had extracted UI modules.
- The entry files carried roughly 93 kB of Logic source and 175 kB of UI source in aggregate.
- Several showcase files were compressed into very long physical lines, which made the source look more like generated payload than deliberately authored application code.
- Large entry files mixed orchestration with telemetry projection, policy, verified commands, demo scenario handling, persistence, charts, SVG scenes and control markup.

This did not violate the Automation Project runtime boundary, but it under-used the project model and made the public source harder to understand than the platform itself.

During the audit a separate editor defect was also reproduced: in a read-only shared project, switching **Logic → UI → Logic** could leave UI source displayed under the Logic tab. The persisted project and seed data were correct; the bug was in Monaco model/value synchronisation in the frontend. That defect is fixed and covered by a regression test as part of this pass.

## Refactor decision

For the public showcase, **Logic and UI are readable orchestration entry points**.

The first attempt at this cleanup made the entries extremely small forwarding shims. That was rejected because it made the source technically tidy but less informative. The final convention is deliberately closer to a good `main()` method:

- **Logic** keeps trigger routing, major policy decisions and the sequence of domain operations visible.
- **UI** keeps state selection, important operator intents and high-level component composition visible.
- **Files** carries lower-level device/command mechanics, data projection, persistence, calculations, demo fixtures, charts, SVGs, styling and larger components.

A visitor should be able to get the general idea of an automation from Logic and UI alone, then open Files to understand its implementation.

All 26 showcase projects now use supporting Logic and UI files. Their entry points are deliberately readable rather than artificially tiny; the regression guard uses generous ceilings to catch a return to monolithic entry files without turning line count into a design goal.

Representative structures include:

- `farm-water/logic/index.ts` as the water control loop, backed by `water-control.ts`, `transfer.ts`, `distribution.ts` and `runtime.ts`
- `vessel-ctd/logic/index.ts` as the CTD orchestration path, backed by `ctd-operations.ts`
- `stage-show-sequencer/logic/index.ts` showing cue/effect/safety sequencing, backed by `show-control.ts`
- `space/logic/index.ts` showing the cadence of the public data sources, backed by `live-space.ts`
- domain-named dashboard/panel components behind every `ui/index.tsx`, with the UI entries exposing their state and actions

## Product rule vs showcase rule

Aeolus itself still allows a genuinely tiny automation to stay in a single Logic file and a tiny UI to stay in `ui/index.tsx`. The stricter rule applies to the seeded showcase because the source is part of the product demonstration.

The general guidance is documented in `docs/architecture/AUTOMATION_PROJECTS.md`: entry points should explain the project's orchestration/composition and should be split when implementation detail begins to obscure that story.

## Final shape and verification

After the main-method pass:

- all 26 projects have at least one supporting Logic module and one supporting UI module;
- Logic entries range from 18 to 43 lines (about 25 lines on average);
- UI entries range from 21 to 40 lines (about 28 lines on average);
- aggregate visible Logic entry source dropped from about 93 kB to about 20 kB;
- aggregate visible UI entry source dropped from about 175 kB to about 27 kB;
- supporting files remain ordinary project source and are formatted/readable when opened through Files.

The refactor was checked against build 40 with a deterministic differential harness covering 2,286 Logic executions across trigger/event, state and device-state profiles. The harness compares state writes, emitted events, device actions, Data Store writes, warnings and observable device mutations. It caught one same-cycle Water Management regression during the refactor; that regression was corrected before packaging.

UI equivalence was checked separately across 52 initial render profiles and 218 button interactions. That caught an accidental Game Master payload change for hint/look controls; the original event contract was restored. TypeScript/TSX parsing and relative project-import resolution also pass across the complete seeded tree.

The full repository test/build suite should still be run in the normal Node 24 development environment before merge; the isolated review environment used for this audit did not have the repository dependency tree available.
