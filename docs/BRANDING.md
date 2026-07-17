# Aeolus design system

Aeolus should feel calm, capable and technical. It deals with real devices and operating environments, so the interface needs to make state, change and failure easy to read without looking like a generic industrial control panel.

## Design principles

1. **Clarity before decoration.** Important state should be obvious at a glance.
2. **Data first.** Values, units, timestamps and status deserve more visual weight than chrome.
3. **Calm motion.** Animation should explain a transition, not compete for attention.
4. **Consistent depth.** Background, surfaces and elevated panels should form a predictable hierarchy.
5. **Room to breathe.** Dense information is acceptable; cramped information is not.
6. **Purpose-built views.** A CTD profiler, game-master console and workshop dashboard do not need to look identical, but they should still feel like Aeolus.

## Colour system

The current tokens are defined in `frontend/tailwind.config.js`.

### Core palette

| Role | Token | Value |
|---|---|---|
| Application background | `background` | `#0B0F14` |
| Main surface | `surface` | `#121821` |
| Elevated surface | `elevated` | `#1A2330` |
| Primary accent | `primary` | `#3BA4FF` |
| Secondary accent | `accent` | `#5CE1E6` |

### Status colours

| Meaning | Token | Value |
|---|---|---|
| Healthy or successful | `success` | `#22C55E` |
| Warning or attention | `warning` | `#F59E0B` |
| Error or destructive action | `error` | `#EF4444` |

### Text and borders

| Role | Value |
|---|---|
| Primary text | `#E6EDF3` |
| Secondary text | `#9AA6B2` |
| Muted text | `#6B7785` |
| Border | `#2A3441` |

Use the blue-to-cyan gradient sparingly for selected tabs, key calls to action and small brand moments:

```css
background: linear-gradient(135deg, #3ba4ff, #5ce1e6);
```

A gradient should signal importance. It should not become the default background for every control.

## Typography

The configured font stacks are:

```text
Interface: Inter, system-ui, sans-serif
Code and machine data: JetBrains Mono, monospace
```

Use the sans-serif stack for navigation, labels, explanations and controls. Use monospace for:

- source code;
- MQTT topics;
- identifiers;
- raw payloads;
- compact measurements where alignment matters.

Suggested scale:

| Use | Size | Weight |
|---|---:|---:|
| Page title | 30 to 34 px | 700 |
| Section title | 22 to 26 px | 600 |
| Card title | 16 to 18 px | 600 |
| Body | 14 to 16 px | 400 |
| Supporting text | 12 to 13 px | 400 |
| Code | 13 px | 500 |

## Language and labels

Write like an operator tool, not a chatbot.

Prefer:

```text
Device offline
Command timed out
Last seen 4 minutes ago
```

Avoid:

```text
Oops! Something went wrong.
Uh-oh, we could not find your device!
```

Labels should be short, but errors should still say what happened and what the user can do next.

## Layout

Aeolus uses an 8 px spacing rhythm. Common component padding is 16 or 24 px.

The application structure is:

```text
Sidebar | page or dashboard workspace
        | cards, panes, editors and detail views
```

Avoid deep nesting of cards inside cards. Borders, surface changes and spacing should be enough to show hierarchy.

## Components

### Cards and panes

Use cards for a single coherent unit such as a device, metric group, automation or configuration area.

Typical treatment:

- `surface` background;
- subtle `#2A3441` border;
- 12 to 16 px radius;
- restrained shadow only when depth is useful;
- clear title, status and primary action.

### Buttons

- **Primary:** the main action on the current surface. Blue or restrained blue-to-cyan treatment.
- **Secondary:** neutral surface with a visible border.
- **Ghost:** low-emphasis navigation or utility action.
- **Destructive:** red only when the action is genuinely destructive.

Do not put several equally loud primary buttons beside one another.

### Toggles and live controls

Controls should visibly distinguish:

- current observed state;
- pending command;
- unavailable or offline state;
- failed command.

A colour change alone is not enough. Use text, icons or progress treatment where the distinction matters.

### Data displays

Always show units when a value is ambiguous. Include timestamps or freshness indicators for live data. Avoid making stale state look current.

Charts should favour readable trends and thresholds over decoration. Use animation carefully for live updates; values should not flash or jump unnecessarily.

### Editors and inspectors

Monaco, MQTT payloads and diagnostic views can be dense. Keep surrounding controls quiet so the technical content remains the focus.

## Icons

Aeolus uses Lucide icons. Keep stroke weight and size consistent within a surface.

Icons support labels; they should not replace unfamiliar labels. A plug, wave or radio symbol can mean several things depending on context.

## Motion

Most interface transitions should sit between 150 and 250 ms with an ease-in-out curve.

Useful motion includes:

- a toggle moving to its new state;
- a pane entering edit mode;
- a value updating without a full redraw;
- a connection indicator changing state;
- a small hover lift where the element is clickable.

Avoid bouncing, repeated pulsing and large background animation. Motion should feel more like airflow than fireworks.

## Logo and visual motifs

The Aeolus mark combines the letter A with wind or signal movement. It should work:

- as a small favicon;
- on the dark application background;
- in a single colour;
- without a wordmark when space is limited.

Supporting motifs can include flow lines, waves and circular movement, but the product UI should not be covered in wind graphics. The name provides the metaphor; the interface still has work to do.

## Custom application UI

User-authored UI may be much more specialised than the core dashboard. A stage cue stack, mine ventilation view or spacecraft subsystem panel can establish its own information hierarchy.

It should still reuse the Aeolus defaults where practical:

- dark surfaces;
- blue and cyan accents;
- Inter and JetBrains Mono;
- familiar status colours;
- clear spacing and borders;
- restrained motion.

The goal is family resemblance, not rigid sameness.

## Accessibility

- Keep text contrast high against dark surfaces.
- Do not communicate status through colour alone.
- Preserve visible keyboard focus.
- Give icon-only controls accessible names.
- Keep hit areas large enough for touch screens.
- Respect reduced-motion preferences for non-essential animation.

## Final check

A finished Aeolus screen should answer three questions quickly:

1. What is happening?
2. Is anything wrong or stale?
3. What can I safely do from here?

If those answers are clear and the interface feels calm, the design is doing its job.
