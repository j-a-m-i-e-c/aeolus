# What Is Aeolus?

> A plain English introduction for grant reviewers, designers, potential employers and anyone else who wants to understand the idea without reading code. For the technical version, see [Why Aeolus?](./WHY_AEOLUS.md).

## In one sentence

**Aeolus is a private, on-site platform that brings different devices, data and automated tasks into one system. It can keep working without the internet or a vendor’s cloud.**

<!--
MEDIA TODO: WHAT hero screenshot
File: media/what-is-aeolus-hero.png
Show: one polished and believable operating dashboard, preferably the real rural property/shed deployment. Include 3 to 5 connected concerns such as tank level, pump status, solar/battery state, temperature and recent history.
Avoid: source code, novelty demo tabs or a collage of unrelated industries. This image is for non-technical reviewers deciding whether the product makes sense.
-->
<!-- ![Aeolus operating a real site](media/what-is-aeolus-hero.png) -->

## The problem it addresses

Physical places increasingly contain “smart” equipment, but the equipment rarely behaves like one system.

A rural property might have solar equipment from one manufacturer, pumps controlled by relays, home-built tank sensors, a weather station with its own app and lights managed through another platform. A research vessel, theatre, workshop or greenhouse faces the same problem in a different costume.

Each product may work well on its own. The difficulty appears when the owner wants them to work together:

- show everything on one useful screen
- keep history in one place
- make decisions using several sources of information
- operate when the internet is unavailable
- avoid sending sensitive site data through several companies’ clouds
- create controls that match the actual job rather than a generic device menu
- understand whether a command was merely sent or the expected result actually occurred.

At that point the problem is no longer “buy a smart switch”. The place needs a small software system of its own.

Aeolus provides the shared foundation for that system.

## A practical example

Imagine a rural property with:

- a lower water tank and a header tank
- a transfer pump
- solar panels and a battery
- a flow meter
- weather and temperature sensors
- shed lighting and power monitoring.

Aeolus can collect the readings and present them in one local dashboard. It can then coordinate a workflow such as:

> When the header tank is low and there is enough stored energy, start a transfer cycle. Stop at the upper limit, keep a record and let the operator know if something does not behave as expected.

The operator does not need to study raw sensor messages. They see the information and controls made for this job: tank levels, available energy, pump state, recent flow and anything that needs attention.

The same system can still provide technical views for the person who built or maintains it.

<!--
MEDIA TODO: Water/energy workflow GIF
File: media/water-energy-workflow.gif
Length: 12 to 18 seconds, no narration required.
Show:
1. Header tank level crosses a low threshold.
2. Aeolus records an automatic decision.
3. Pump state changes.
4. Flow rises and the result is shown as confirmed.
5. The dashboard/history updates.
Use simulation if necessary, but label it clearly as a demonstration.
-->
<!-- ![A water and energy workflow in Aeolus](media/water-energy-workflow.gif) -->

## What Aeolus actually does

Aeolus sits between the equipment and the people operating the site.

```text
Sensors, devices and services
            ↓
          Aeolus
  collects · decides · records
            ↓
Dashboards, controls and alerts
```

It provides several functions in one platform.

### It connects different equipment

Custom sensors and controllers can communicate through MQTT, a common lightweight messaging standard. Commercial products can be added through connectors that translate their own APIs into the same Aeolus device model.

Hue lighting and TP-Link Kasa devices are included today. The connector framework is designed so more equipment can be added without redesigning the platform.

### It runs automated decisions locally

Rules and workflows run on the computer installed at the site. An internet outage does not need to stop a water cycle, a stage cue, a local alarm or an instrument display.

External information can still be useful, such as a weather forecast or launch schedule. The difference is that the site does not hand control of its basic operation to that service.

### It presents information in a form suited to the task

Aeolus is not limited to a standard list of device cards. A technical author can build a specific panel for a water system, greenhouse zone, CTD profiler, game-master console or stage cue stack.

That means the everyday user can see a clear operating screen without being exposed to the underlying complexity.

### It stores useful local history

Aeolus can retain device history, measurements, calculated values and automation results. This supports questions such as:

- How quickly is the tank falling?
- What did the CTD sonde measure at 80 metres?
- Which puzzle held up the last escape-room session?
- Did the gas reading rise before the ventilation fans changed speed?
- Which stage cue was active when an effect failed?

### It keeps useful evidence

Aeolus records state, events and automation activity so the operator can see what the system believed and what it did. Some devices can also report whether they received a command or whether another sensor observed the expected result.

That extra confirmation is useful when available, but it is one feature of a much larger platform. The main goal is to make the whole site easier to understand, operate and change.

## What makes it different

### Local-first ownership

Aeolus is intended to run on a small Linux computer at the site, such as a Raspberry Pi or other compact machine.

The site keeps its operating logic and central application data locally. There is no mandatory Aeolus cloud account or subscription required for core operation.

This is valuable when:

- connectivity is unreliable
- privacy matters
- response time should not depend on the internet
- a vendor service may change, close or become expensive
- the system needs to remain useful for years.

### Built for custom requirements

Many automation products are designed to make common tasks easy. Aeolus is designed for the point where the requirement is unusual enough that someone needs to build the exact behaviour.

It trades mass-market simplicity for flexibility. The author is expected to be a software developer, technical integrator or capable enthusiast. The person who uses the finished dashboard each day does not need to be a programmer.

### One platform for behaviour and interface

An Aeolus workflow can contain both the behaviour and the screen used to operate it.

A research-vessel CTD profiler might collect depth, temperature and salinity while presenting the cast as a purpose-built scientific display. An escape-room sequencer might track puzzle progress, release locks and give the game master a timer and hint controls. A solar pump manager might combine levels, energy and manual overrides in one panel.

These are different applications, but they use the same platform underneath. The interface stays close to the behaviour it represents instead of living in a separate dashboard product.

### Designed as a platform, not one fixed appliance

Aeolus began with real rural infrastructure, but its building blocks are general. Devices produce events, automated applications make decisions, data is stored and operators use tailored interfaces.

Those same building blocks can serve many environments.

<!--
MEDIA TODO: Simple concept diagram
File: media/aeolus-concept.png
Create a clean designed diagram with three columns:
LEFT: MQTT sensors, commercial devices, local APIs, external services.
CENTRE: Aeolus: device model, automation, local data, command tracking.
RIGHT: operator dashboard, custom control panels, history/alerts.
Keep labels understandable to a non-engineer; do not use internal class names.
-->
<!-- ![How Aeolus connects equipment, decisions and people](media/aeolus-concept.png) -->

## Where it could be used

Aeolus is not tied to one industry. The included seed demo deliberately jumps between very different settings:

- **rural property and agriculture:** tanks, troughs, pumps, fencing, weather and energy
- **research vessel:** CTD casts, ROV telemetry, seawater instruments and station keeping
- **underground mine:** gas monitoring, ventilation demand, personnel muster and dewatering
- **stage and show control:** lighting scenes, cue stacks, haze and operator controls
- **escape room:** puzzles, locks, hints, timers and game-master tools
- **spacecraft or remote station:** power, communications windows, environmental data and local autonomy
- **off-grid bunker:** generator fuel, air filtration, supplies and perimeter events
- **wildlife projects:** nest sensors, local camera detections and biodiversity records

The demos are there to show the range of the platform, not to claim that Aeolus already ships certified hardware support for every one of those fields.

## Who it is for

Aeolus has two kinds of user.

### The builder

The builder is likely to be:

- a software developer
- an IoT or automation integrator
- an engineer comfortable with software
- a technically capable owner building a system for their own site.

They connect devices, write the site-specific logic and design the interface.

### The operator

The operator may simply need to:

- check the site
- respond to an alert
- change a target
- start or stop a process
- understand why an automatic decision occurred.

The operator can use a focused dashboard without seeing or editing code.

## What Aeolus is not

Aeolus is not a plug-and-play consumer appliance or a replacement for certified safety systems. It is a developer-built platform for custom projects, and it still expects the real equipment to have the electrical, mechanical and emergency protection appropriate to the job.

It is also still an early project. The core is working, but it has not yet earned the kind of field history that comes from hundreds of installations.

## What exists today

The current platform includes:

- a local dashboard with custom tabs and movable panes
- MQTT device ingestion and command publishing
- a connector system with Philips Hue and TP-Link Kasa support
- code-driven automation with a built-in editor
- optional custom interfaces for individual automations
- persistent state and local time series storage
- device history and operational metrics
- authentication, user groups and MQTT credential controls
- isolated execution for backend logic and custom frontend components
- versioned database upgrades and pre-upgrade backups
- Docker and Raspberry Pi deployment.


## Why it may matter

Many physical sites are too specialised for a mass-market product but too small to justify commissioning a completely new software platform.

Today, a capable integrator may assemble MQTT, scripts, a dashboard, a database and several vendor APIs for each project. That can work, but the shared platform work is repeated and the result may be difficult to maintain.

Aeolus tries to make that middle ground reusable:

> Build the part that is unique to the place on top of a common local platform.

If that model proves useful to people beyond its original author, Aeolus could become:

- a strong open or source-available developer project
- the foundation for bespoke integration work
- a platform used by small IoT integrators
- technology underneath a more focused rural, energy or automation product
- or simply a substantial demonstration of modern edge-platform engineering.

The right direction should come from real users and deployments, not from guessing in a README.

## The takeaway

Aeolus gives a physical place something closer to its own small software platform.

It connects equipment that was never designed to work together, keeps the important runtime on site, lets a developer build the exact behaviour the place needs and gives the operator an interface that makes sense for the job.

It began with pumps, tanks, solar and sensors on one rural property. The same building blocks can become a research instrument, a game-master console, a mine ventilation view or a stage cue system. That is the larger idea: one local foundation that can be shaped around many different parts of the physical world.

And when the zombie apocalypse finally arrives and the internet goes dark, every cloud-tethered smart home on the street becomes a very expensive collection of switches that no longer switch. Meanwhile, down in the bunker, Aeolus is still tracking the generator fuel, cycling the air filter, counting the tins of beans and lighting the perimeter when something shuffles past. It does not need the cloud. It never did.
