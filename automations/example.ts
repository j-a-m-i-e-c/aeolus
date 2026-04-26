// automations/example.ts — Smart Evening Mode
// Trigger topic: sensor/+/light
// When ambient light drops below 200 lux during evening hours,
// dim all Hue lights and publish a mode change notification.

import { when } from "../src/automations/dsl.js";

export default when("sensor/+/light")
  .if((ctx) => {
    const lux = ctx.state.value as number;
    const hour = new Date(ctx.timestamp).getHours();
    return typeof lux === "number" && lux < 200 && hour >= 16 && hour < 23;
  })
  .then((ctx) => {
    console.log(`[Evening Mode] Low light detected: ${ctx.state.value} lux — activating evening mode`);
  }, "Smart Evening Mode");
