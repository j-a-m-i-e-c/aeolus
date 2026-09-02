// frontend/src/sandbox/ui-kit/index.test.ts — the @aeolus/ui module offered to custom UIs

import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  control,
  controlProps,
  controlState,
  decimal,
  flow,
  formatNumber,
  integer,
  kilowatts,
  litres,
  metres,
  percent,
  rpm,
  salinity,
  temperature,
  toggleProps,
  tokens,
  watts,
  type ControlState,
} from "./index";

describe("tokens", () => {
  it("carries the Aeolus theme colours custom UIs cannot reach through Tailwind", () => {
    expect(tokens.color.primary).toBe("#3BA4FF");
    expect(tokens.color.background).toBe("#0B0F14");
    expect(tokens.font.mono).toContain("JetBrains Mono");
  });
});

describe("controlProps", () => {
  const states: ControlState[] = ["available", "current", "disabled", "pending", "danger"];

  it("returns styling for every state", () => {
    for (const state of states) {
      const visual = controlProps(state);
      expect(typeof visual.style.borderColor).toBe("string");
      expect(typeof visual.disabled).toBe("boolean");
    }
  });

  it("only lets available and danger be pressed", () => {
    expect(controlProps("available").disabled).toBe(false);
    expect(controlProps("danger").disabled).toBe(false);
    expect(controlProps("current").disabled).toBe(true);
    expect(controlProps("disabled").disabled).toBe(true);
    expect(controlProps("pending").disabled).toBe(true);
  });

  it("makes a disabled control visibly unavailable, not merely inert", () => {
    // The whole point of the state system: relying on the HTML disabled attribute
    // alone left inappropriate actions looking as pressable as available ones.
    const disabled = controlProps("disabled");
    const available = controlProps("available");

    expect(disabled.style.cursor).toBe("not-allowed");
    expect(available.style.cursor).toBe("pointer");
    expect(disabled.style.color).toBe(tokens.color.textMuted);
    expect(disabled.style.color).not.toBe(available.style.color);
    expect(disabled.style.borderColor).not.toBe(available.style.borderColor);
    expect(Number(disabled.style.opacity)).toBeLessThan(1);
  });

  it("distinguishes every state's border from the others", () => {
    const borders = states.map((state) => String(controlProps(state).style.borderColor));
    expect(new Set(borders).size).toBe(states.length);
  });

  it("marks the current mode as pressed rather than as an action", () => {
    const current = controlProps("current");
    expect(current["aria-pressed"]).toBe(true);
    expect(current.style.cursor).toBe("default");
  });

  it("marks a pending control busy so its wait is announced", () => {
    const pending = controlProps("pending");
    expect(pending["aria-busy"]).toBe(true);
    expect(pending.style.color).toBe(tokens.color.warning);
  });

  it("signals a consequential action without disabling it", () => {
    const danger = controlProps("danger");
    expect(danger.style.color).toBe(tokens.color.error);
    expect(danger.disabled).toBe(false);
  });
});

describe("controlState", () => {
  it("defaults to available", () => {
    expect(controlState()).toBe("available");
    expect(controlState({})).toBe("available");
  });

  it("resolves each condition", () => {
    expect(controlState({ pending: true })).toBe("pending");
    expect(controlState({ disabled: true })).toBe("disabled");
    expect(controlState({ current: true })).toBe("current");
    expect(controlState({ danger: true })).toBe("danger");
  });

  it("ranks a pending request above every other condition", () => {
    // The outcome is not known yet, so nothing else may claim the control.
    expect(controlState({ pending: true, disabled: true, current: true, danger: true })).toBe("pending");
  });

  it("ranks an inappropriate action above the current mode", () => {
    // A control must never read as the live mode and as unavailable at once.
    expect(controlState({ disabled: true, current: true })).toBe("disabled");
  });

  it("ranks the current mode above danger", () => {
    expect(controlState({ current: true, danger: true })).toBe("current");
  });

  it("control() composes state resolution with styling", () => {
    expect(control({ disabled: true })).toEqual(controlProps("disabled"));
    expect(control()).toEqual(controlProps("available"));
  });
});

describe("toggleProps", () => {
  it("stays pressable when on, because a switch must be turnable off", () => {
    // This is why a toggle is not `current`: `current` disables the control.
    const on = toggleProps(true);
    expect(on.disabled).toBe(false);
    expect(on["aria-pressed"]).toBe(true);
    expect(on.style.cursor).toBe("pointer");
    expect(controlProps("current").disabled).toBe(true);
  });

  it("reads as engaged when on and plain when off", () => {
    const on = toggleProps(true);
    const off = toggleProps(false);
    expect(on.style.color).toBe(tokens.color.success);
    expect(off.style.color).toBe(tokens.color.textSecondary);
    expect(on.style.borderColor).not.toBe(off.style.borderColor);
    expect(off["aria-pressed"]).toBe(false);
  });

  it("presents a request in flight as pending while still reporting the mode", () => {
    const pending = toggleProps(true, { pending: true });
    expect(pending.disabled).toBe(true);
    expect(pending["aria-busy"]).toBe(true);
    expect(pending["aria-pressed"]).toBe(true);
  });

  it("can be unavailable while still reporting the mode", () => {
    const blocked = toggleProps(false, { disabled: true });
    expect(blocked.disabled).toBe(true);
    expect(blocked.style.cursor).toBe("not-allowed");
    expect(blocked["aria-pressed"]).toBe(false);
  });

  it("treats a pending request as outranking unavailability", () => {
    const both = toggleProps(true, { pending: true, disabled: true });
    expect(both["aria-busy"]).toBe(true);
  });
});

describe("number formatting", () => {
  it("never renders a raw float artefact", () => {
    // The bug this replaces: a battery read of 73.89999999999999 reaching the DOM.
    expect(percent(73.89999999999999)).toBe("74%");
    expect(decimal(73.89999999999999)).toBe("73.9");
  });

  it("returns a placeholder for state that has not arrived", () => {
    // aeolus.read() is unknown and undefined until the first telemetry lands.
    // null, "" and [] must NOT become 0: Number() maps all three to zero, which
    // would render a missing reading as a real measurement of nothing. Booleans
    // are rejected for the same reason.
    for (const absent of [undefined, null, "", "   ", "abc", NaN, Infinity, -Infinity, {}, [], true, false]) {
      expect(formatNumber(absent)).toBe(NO_VALUE);
      expect(percent(absent)).toBe(NO_VALUE);
      expect(rpm(absent)).toBe(NO_VALUE);
      expect(temperature(absent)).toBe(NO_VALUE);
      expect(metres(absent)).toBe(NO_VALUE);
      expect(flow(absent)).toBe(NO_VALUE);
      expect(litres(absent)).toBe(NO_VALUE);
      expect(salinity(absent)).toBe(NO_VALUE);
      expect(watts(absent)).toBe(NO_VALUE);
      expect(kilowatts(absent)).toBe(NO_VALUE);
      expect(integer(absent)).toBe(NO_VALUE);
      expect(decimal(absent)).toBe(NO_VALUE);
    }
  });

  it("accepts a numeric string, since state values cross a JSON boundary", () => {
    expect(percent("42.4")).toBe("42%");
    expect(temperature("12.36")).toBe("12.4 °C");
  });

  it("applies the documented precision per unit", () => {
    expect(percent(73.4)).toBe("73%");
    expect(percent(73.45, 1)).toBe("73.5%");
    expect(temperature(12.34)).toBe("12.3 °C");
    expect(rpm(2378.4)).toBe("2378 rpm");
    expect(metres(419.6)).toBe("420 m");
    expect(flow(72)).toBe("72.0 L/min");
    expect(salinity(35.1234)).toBe("35.12 PSU");
    expect(watts(41.6)).toBe("42 W");
    expect(kilowatts(2.104)).toBe("2.10 kW");
  });

  it("separates thousands in quantities but not in instrument readings", () => {
    // "12,500 L" is how a total reads; "3200 rpm" is how the gauge reads.
    expect(litres(12500)).toBe(`${(12500).toLocaleString()} L`);
    expect(integer(8421)).toBe((8421).toLocaleString());
    expect(rpm(3200)).toBe("3200 rpm");
    expect(watts(1500)).toBe("1500 W");
  });

  it("keeps zero as a real reading rather than a missing one", () => {
    // A pump at 0 L/min is the observation that proves it stopped.
    expect(flow(0)).toBe("0.0 L/min");
    expect(percent(0)).toBe("0%");
    expect(rpm(0)).toBe("0 rpm");
  });

  it("formats negative readings", () => {
    expect(temperature(-3.25)).toBe("-3.3 °C");
    expect(metres(-12)).toBe("-12 m");
  });
});
