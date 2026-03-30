# 🌬️ Aeolus — Design System & Style Guide

## Brand Essence

**Aeolus** represents invisible force, flow, and control.

It is:

* Clean
* Powerful
* Precise
* Invisible but ever-present

### Core Concept

> Devices communicate through “the wind” — unseen, seamless, continuous.

---

## Visual Direction

### Design Pillars

1. **Clarity over decoration**
2. **Bold contrast**
3. **Subtle motion (not flashy)**
4. **Data-first UI**
5. **Airy spacing (breathing room)**

---

## Color System

### 🎯 Primary Palette

| Role              | Color       | Hex       |
| ----------------- | ----------- | --------- |
| Background (Dark) | Deep Void   | `#0B0F14` |
| Surface           | Graphite    | `#121821` |
| Elevated Surface  | Slate       | `#1A2330` |
| Primary Accent    | Aeolus Blue | `#3BA4FF` |
| Secondary Accent  | Wind Cyan   | `#5CE1E6` |

---

### ⚡ Accent & Feedback

| Role    | Color    | Hex       |
| ------- | -------- | --------- |
| Success | Emerald  | `#22C55E` |
| Warning | Amber    | `#F59E0B` |
| Error   | Soft Red | `#EF4444` |

---

### 🧠 Neutral System

| Role           | Color     |
| -------------- | --------- |
| Primary Text   | `#E6EDF3` |
| Secondary Text | `#9AA6B2` |
| Muted Text     | `#6B7785` |
| Border         | `#2A3441` |

---

### Gradient (Signature Look)

Used sparingly for hero elements:

```css
background: linear-gradient(135deg, #3BA4FF, #5CE1E6);
```

---

## Typography

### Font Stack

Primary:

* Inter (clean, modern, dev-friendly)

Alternative:

* SF Pro (if Apple ecosystem)

Monospace:

* JetBrains Mono (for code + MQTT topics)

---

### Type Scale

| Usage | Size    | Weight |
| ----- | ------- | ------ |
| H1    | 32px    | 700    |
| H2    | 24px    | 600    |
| H3    | 18px    | 600    |
| Body  | 14–16px | 400    |
| Small | 12px    | 400    |
| Code  | 13px    | 500    |

---

### Tone

* No fluff
* Short labels
* Technical but readable

Example:

* ✅ “Device Offline”
* ❌ “Oops! Something went wrong with your device”

---

## Layout System

### Grid

* 8px base spacing system
* Consistent padding: 16px / 24px

---

### Layout Philosophy

* Left sidebar navigation
* Main content = modular cards
* Avoid deep nesting

---

### Example Layout

```id="n6w9e1"
[ Sidebar ]  [ Top Bar ]
             [ Dashboard Grid ]
             [ Device Cards ]
```

---

## Components

### 🧱 Cards (Core UI Element)

Used for:

* Devices
* Sensors
* Automations

Style:

* Background: `#121821`
* Border radius: 12–16px
* Subtle border
* Soft shadow

---

### 🔘 Buttons

#### Primary

* Blue gradient
* Bold text
* Slight glow on hover

#### Secondary

* Outline
* Minimal fill

#### Ghost

* No background
* Text only

---

### 🎚️ Toggles (Important)

These are everywhere.

Style:

* Smooth animated transitions
* Glow when active
* Color shift (grey → blue)

---

### 📊 Data Displays

* Use monospace for:

  * MQTT topics
  * Raw values
* Keep alignment clean
* Avoid clutter

---

## Iconography

### Style

* Thin stroke icons
* Consistent weight
* Minimal detail

### Library

* Lucide (recommended)

---

### Common Icons

* Device → square/box
* Light → bulb
* Sensor → radar/wave
* MQTT → signal/wifi

---

## Motion & Animation

### Philosophy

> Motion should feel like airflow — smooth and natural.

---

### Guidelines

* 150–250ms transitions
* Ease-in-out
* No bouncing

---

### Examples

* Toggle switch slides smoothly
* Cards fade + lift on hover
* Data updates subtly (no flashing)

---

## Dashboard Design

### Key Sections

1. Device Grid
2. Live Data Stream
3. Automation Status
4. System Health

---

### Device Card Example

```id="n2u6rx"
[ Light: Living Room ]
Status: ON
Brightness: 80%

[ Toggle ]   [ Adjust ]
```

---

## Developer-Focused UI Elements

### Code Blocks

* Dark background
* Syntax highlighting
* Monospace font

---

### MQTT Inspector (Cool Feature)

```id="0p9e8c"
Topic: sensor/kitchen/temp
Payload: 22.4
Timestamp: 12:03:22
```

---

## Branding Elements

### Logo Direction

Concept:

* Wind swirl
* Signal waves
* Circular motion

Style:

* Minimal
* Geometric
* Works as app icon

---

### Visual Motifs

* Flow lines
* Subtle particle movement
* Wave patterns

---

## Do / Don’t

### ✅ Do

* Keep everything minimal
* Use spacing generously
* Prioritize readability

### ❌ Don’t

* Overuse gradients
* Add unnecessary animations
* Clutter dashboards

---

## UI Personality

If Aeolus were a product personality:

* Calm
* Intelligent
* Precise
* Invisible but powerful

---

## Inspiration References

* Linear.app (clean SaaS)
* Vercel dashboard
* Modern dev tools (Grafana-lite feel)

---

## Implementation Notes

### Tailwind Tokens Example

```js
colors: {
  background: "#0B0F14",
  surface: "#121821",
  primary: "#3BA4FF",
  accent: "#5CE1E6",
}
```

---

## Final Design Principle

> “If it feels obvious, fast, and calm — it’s correct.”

---

END OF STYLE GUIDE
