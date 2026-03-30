// automations/example.ts — Sample automation rule
//
// This file demonstrates the when/if/then DSL.
// Place rule files in this directory and they will be loaded on startup.

import { when } from "../src/automations/dsl.js";

/** Turn on living room light when motion is detected at night */
export default when("motion/living-room")
  .if((ctx) => {
    const hour = new Date(ctx.timestamp).getHours();
    return hour >= 20 || hour < 6; // Night time: 8pm - 6am
  })
  .then((ctx) => {
    console.log(`[Automation] Motion detected in living room at night — turning on light`);
    // In production, this would call: devices.light("living-room").on()
  }, "Night motion → living room light");
