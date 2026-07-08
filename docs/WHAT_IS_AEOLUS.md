# What Is Aeolus? (Plain-English Version)

*A one-page explainer for anyone — no technical background needed. For the deep technical version, see [WHY_AEOLUS.md](./WHY_AEOLUS.md).*

## In one sentence

Aeolus is a private "control room" for the physical things around you — sensors, pumps, lights, motors, cameras, switches — that runs on a small computer you own and keep on-site, with no cloud account and no internet required.

## A concrete example

Picture a farm. You've got a dam, a couple of water tanks, pumps, 20 cattle troughs, and GPS collars on the herd. On their own, they're disconnected gadgets you check by walking around.

With Aeolus, they all show up on one screen. Then you set up instructions in plain terms: *"When the header tank drops below 60%, run the dam pump until it's full,"* or *"If a collar leaves the paddock, flag it as a stray."* Aeolus watches everything around the clock and acts on its own. You open a dashboard on your phone or laptop to see live levels, check history, or take manual control — from the house, the shed, or the far side of the property.

That farm setup is one of the demo dashboards Aeolus ships with. Swap it for any other world and the idea is identical.

## The same tool, wildly different jobs

Aeolus isn't a farm gadget, or a smart-home gadget. It's a general tool for running *any* physical space. The built-in demos show the range — every one of these is a real, connectable setup:

- **Agriculture** — farm water management, cattle troughs, and GPS herd tracking.
- **Research vessel** — ocean instruments, ship positioning, and underwater-drone dive telemetry.
- **Underground mine** — gas-safety monitoring, ventilation on demand, and tracking who's underground.
- **Spacecraft / satellite** — life support, power, and ground-station communication passes.
- **Escape room** — puzzles, props, and effects fired on cue.
- **Stage & show** — a theatre lighting board, cue stack, haze machines, and safety-locked pyro.
- **Space tracker** — live rocket launches and the position of the space station overhead.
- **Off-grid bunker** — generator fuel, air filtration, supply levels, and a motion-triggered perimeter.
- **Wildlife & conservation** — an on-device AI trail camera, a nest-box monitor, a humane predator deterrent, and a biodiversity log (more on this below).

Same underlying system, nine completely different worlds. That's the whole point.

## A cause worth pointing it at: wildlife & conservation

This is the demo I'm most excited about, so it now ships as its own tab you can open and play with. Modern Raspberry Pis can take a small add-on "AI chip" — roughly the size of a stick of gum — that recognises what's in a camera feed *right there on the device*, no internet involved. Point a camera at a nest or a trail, and that on-site brain can tell a possum from a quoll, or spot a predator approaching.

Aeolus takes it from there. A detection becomes just another event it can act on: log which animals come and go, watch a nest's temperature and movement, sound an alert or trigger a deterrent the instant a predator appears, and keep a quiet, timestamped record for researchers. Add solar and a battery and the whole thing lives happily on a fence post for months.

The offline, private nature matters more here than anywhere. The analysis happens on the device, so you're not streaming footage of an endangered species' nesting site to someone's cloud, and you don't need a phone signal in the middle of nowhere. For remote or protected sites, "runs entirely on-site and keeps your data" isn't a nice-to-have — it's the whole reason it's possible at all.

The demo tab simulates the whole loop — detections rolling in from the camera, a nest warming and cooling, the deterrent arming itself — so you can see how it feels without any hardware. The AI chip itself is real, off-the-shelf kit; wiring a physical camera to it is on the [roadmap](ROADMAP.md).

## What problem does it solve?

Most "smart" systems have one of two problems:

- **They live in someone else's cloud.** They need constant internet, route your data through a company's servers, often charge a subscription, and if that company pivots or shuts down, your setup stops working.
- **They're rigid.** You can only do what their menus allow. The moment you want something a little unusual, you hit a wall.

Aeolus flips both. Everything runs on your own hardware, on your local network. It keeps working with the internet unplugged. Your data stays with you. And instead of a fixed menu, it lets you express *exactly* what you want your space to do.

## What's genuinely cool about it

- **It's yours.** Runs on a cheap on-site computer (about an $80 Raspberry Pi). No accounts, no subscriptions, nothing phoning home.
- **It works offline.** Ideal for places with patchy or no internet — a remote farm, a boat, a mine, a research station, a bunker.
- **It's private.** Nothing about your property leaves it unless you specifically choose to send it somewhere.
- **Your whole setup is one file.** Every device, automation, dashboard, and all your history live in a single database file. Back it up by copying it; to move to a new machine, install Aeolus there and drop that one file in. No lock-in, no export wizard.
- **Every automation gets its own custom screen.** You don't just get raw numbers; you can design a tidy control panel for each thing — a dial, a slider, a status light — and it updates live.
- **It grows with you.** Built like real software, so there's effectively no ceiling on what it can do, and support for new gadgets can be added over time.

## Is it for me?

Honest answer: Aeolus is aimed at people comfortable writing a little logic — or who have a technical friend to help set it up. It trades "anyone can use it out of the box" for "you can make it do anything." If you just want to plug in off-the-shelf smart-home gadgets with zero setup, something like Home Assistant is a better fit. If you want real, private, offline control that you fully own — and the freedom to build precisely what your space needs — that's exactly what Aeolus is for.

## The takeaway

Think of it as the difference between renting and owning. Most smart systems rent you convenience on their terms. Aeolus hands you the keys: your hardware, your data, your rules, running quietly on-site whether the internet is up or not.

And when the zombie apocalypse finally arrives and the internet goes dark, every cloud-tethered smart home on the street becomes a very expensive light switch that no longer switches. Meanwhile, down in the bunker, Aeolus is still tracking the generator fuel, cycling the air filter, counting the tins of beans, and lighting up the perimeter when something shuffles past. It doesn't need the cloud. It never did.
