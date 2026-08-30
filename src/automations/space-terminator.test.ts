// src/automations/space-terminator.test.ts
//
// The Live Space map shades the night side of Earth. That shading used to be a
// decorative band positioned by `(now/240000 % 1) * 480`, i.e. it swept the whole
// world every four minutes with no dependence on latitude, season or the sun —
// obviously fake to anyone watching it for more than a moment.
//
// It is now derived from the real subsolar point. These tests pull the two helpers
// out of the shipped UI source and check them against known astronomy, so the
// geometry cannot silently regress into decoration again.

import { describe, it, expect } from "vitest";
import { transformSync } from "esbuild";
import { pickDeclaration } from "../__test-helpers__/pick-source-declaration.js";
import spaceTab from "../../demo/seed/tabs/space.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/space; expose it as
// scriptSource/uiSource for the source-level extraction below.
attachSeedProjectSource(...spaceTab.automations);

const RAD = Math.PI / 180;

interface Subsolar { lat: number; lon: number }
interface NightShape { area: string; line: string }

const uiSource: string = (spaceTab.automations[0] as { uiSource: string }).uiSource;

/**
 * Compile the two geometry helpers out of the UI source and hand them back as real
 * functions. They are self-contained plain TypeScript (no JSX, no imports), so they
 * can be transpiled and evaluated on their own — this exercises the SHIPPED code
 * rather than a copy of the algorithm, which would prove nothing.
 */
const { subsolar, nightShape } = (() => {
  // Project UI modules export their helpers and may wrap a declaration across
  // lines, so lift the whole balanced declaration rather than a single line.
  const pick = (name: string): string => pickDeclaration(uiSource, name);
  const { code } = transformSync(
    `${pick("subsolar")}\n${pick("nightShape")}\nreturn { subsolar, nightShape };`,
    { loader: "ts" },
  );
  return new Function(code)() as {
    subsolar: (ms: number) => Subsolar;
    nightShape: (s: Subsolar) => NightShape;
  };
})();

/** Solar elevation at a place, from the subsolar point — the physical ground truth. */
function elevation(lat: number, lon: number, sub: Subsolar): number {
  const H = (lon - sub.lon) * RAD;
  return (
    Math.asin(
      Math.sin(lat * RAD) * Math.sin(sub.lat * RAD) +
        Math.cos(lat * RAD) * Math.cos(sub.lat * RAD) * Math.cos(H),
    ) / RAD
  );
}

describe("Live Space map is not a decorative sweep", () => {
  it("no longer positions the shading from a short wall-clock modulo", () => {
    expect(uiSource).not.toContain("now/240000");
    // Any bare `now/<small number> % 1` positioning is the same mistake.
    expect(uiSource).not.toMatch(/x=\{\(now\/\d+%1\)/);
  });

  it("derives the shading from the subsolar point", () => {
    expect(uiSource).toContain("function subsolar(");
    expect(uiSource).toContain("function nightShape(");
    expect(uiSource).toContain("night.area");
  });

  it("recomputes only about once a minute, not every animation frame", () => {
    // The terminator moves 0.25 deg/min, so per-second recomputation is pointless
    // work; the memo key must be minute-resolution. Matched whitespace-insensitively
    // so reformatting the showcase source cannot fail a test that is really about
    // the memo key resolution.
    expect(uiSource).toMatch(
      /useMemo\(\s*\(\)\s*=>\s*subsolar\(now\)\s*,\s*\[\s*Math\.floor\(\s*now\s*\/\s*60000\s*\)\s*\]\s*\)/,
    );
  });
});

describe("subsolar point", () => {
  it("reaches the solstice declinations", () => {
    expect(subsolar(Date.parse("2026-06-21T08:25:00Z")).lat).toBeCloseTo(23.44, 1);
    expect(subsolar(Date.parse("2026-12-21T20:50:00Z")).lat).toBeCloseTo(-23.44, 1);
  });

  it("crosses the equator at the equinoxes", () => {
    expect(Math.abs(subsolar(Date.parse("2026-03-20T14:46:00Z")).lat)).toBeLessThan(0.1);
    expect(Math.abs(subsolar(Date.parse("2026-09-23T00:05:00Z")).lat)).toBeLessThan(0.1);
  });

  it("stays within the tropics all year", () => {
    for (let day = 0; day < 365; day += 7) {
      const { lat } = subsolar(Date.UTC(2026, 0, 1) + day * 86400000);
      expect(Math.abs(lat)).toBeLessThanOrEqual(23.5);
    }
  });

  it("sits near the prime meridian at noon UTC and the anti-meridian at midnight", () => {
    // Within the equation of time (about +/-4 deg across the year).
    const noon = subsolar(Date.parse("2026-03-20T12:00:00Z")).lon;
    expect(Math.abs(noon)).toBeLessThan(5);
    const midnight = subsolar(Date.parse("2026-03-20T00:00:00Z")).lon;
    expect(180 - Math.abs(midnight)).toBeLessThan(5);
  });

  it("tracks westward at 15 degrees per hour — one rotation per day", () => {
    const t0 = Date.UTC(2026, 5, 1);
    const drift = (ms: number): number => {
      const a = subsolar(t0).lon;
      const b = subsolar(t0 + ms).lon;
      return ((a - b + 540) % 360) - 180;
    };
    expect(drift(3600000)).toBeCloseTo(15, 1);
    expect(drift(60000)).toBeCloseTo(0.25, 2);
    // The band this replaced completed a full sweep every four minutes.
    expect(360 / drift(3600000)).toBeCloseTo(24, 1);
  });
});

describe("night shading geometry", () => {
  const times = [
    "2026-01-15T03:00:00Z",
    "2026-03-20T14:46:00Z",
    "2026-06-21T12:00:00Z",
    "2026-09-23T00:05:00Z",
    "2026-12-21T18:00:00Z",
  ];

  it.each(times)("shades exactly the dark hemisphere at %s", (iso) => {
    const sub = subsolar(Date.parse(iso));
    // The UI closes the curve toward the pole tilted away from the sun.
    const southIsDark = Math.tan(sub.lat * RAD) > 0;
    let t = Math.tan(sub.lat * RAD);
    if (Math.abs(t) < 1e-6) t = t < 0 ? -1e-6 : 1e-6;

    for (let lon = -180; lon <= 180; lon += 5) {
      const termLat = Math.atan(-Math.cos((lon - sub.lon) * RAD) / t) / RAD;
      for (const offset of [-6, 6]) {
        const lat = termLat + offset;
        if (lat < -89 || lat > 89) continue;
        const shaded = southIsDark ? lat < termLat : lat > termLat;
        expect(
          shaded,
          `lat ${lat.toFixed(1)} lon ${lon}: shaded=${shaded} but elevation says dark=${elevation(lat, lon, sub) < 0}`,
        ).toBe(elevation(lat, lon, sub) < 0);
      }
    }
  });

  it.each(times)("produces a closed path inside the map viewport at %s", (iso) => {
    const { area, line } = nightShape(subsolar(Date.parse(iso)));
    expect(area.startsWith("M")).toBe(true);
    expect(area.endsWith("Z")).toBe(true);
    expect(line.startsWith("M")).toBe(true);
    expect(area).not.toMatch(/NaN|Infinity/);

    // The map occupies x 0..480, y 18..258 of the SVG viewBox.
    const coords = area.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
    expect(coords.length).toBeGreaterThan(100);
    for (let i = 0; i < coords.length; i += 2) {
      expect(Number.isFinite(coords[i])).toBe(true);
      expect(coords[i]).toBeGreaterThanOrEqual(0);
      expect(coords[i]).toBeLessThanOrEqual(480);
      expect(coords[i + 1]).toBeGreaterThanOrEqual(18);
      expect(coords[i + 1]).toBeLessThanOrEqual(258);
    }
  });

  it("spans the full width so the terminator never leaves a gap", () => {
    const { line } = nightShape(subsolar(Date.parse("2026-06-21T12:00:00Z")));
    const xs = line.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(480);
  });

  it("closes to the southern edge in northern summer and the northern edge in winter", () => {
    // Northern summer: the north pole is lit, so night holds the south pole.
    expect(nightShape(subsolar(Date.parse("2026-06-21T12:00:00Z"))).area).toContain("L480 258");
    expect(nightShape(subsolar(Date.parse("2026-12-21T12:00:00Z"))).area).toContain("L480 18");
  });

  it("keeps the poles correct through continuous polar day and night", () => {
    // Svalbard (78.2N): lit around the clock in June, dark around the clock in December.
    for (let h = 0; h < 24; h++) {
      expect(elevation(78.2, 15.6, subsolar(Date.UTC(2026, 5, 21, h)))).toBeGreaterThan(0);
      expect(elevation(78.2, 15.6, subsolar(Date.UTC(2026, 11, 21, h)))).toBeLessThan(0);
    }
  });

  it("degenerates to a meridian pair at the equinox rather than breaking", () => {
    // tan(dec) -> 0 there, which would divide by zero without the clamp.
    const sub = subsolar(Date.parse("2026-03-20T14:46:00Z"));
    expect(Math.abs(sub.lat)).toBeLessThan(0.1);
    const { area } = nightShape(sub);
    expect(area).not.toMatch(/NaN|Infinity/);

    // At an equinox the terminator is a pair of meridians, so the shaded region is
    // a vertical half of the map. Shoelace area is the robust way to say that:
    // the map is 480 x 240, so night should cover half of it.
    const nums = area.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
    let shoelace = 0;
    for (let i = 0; i < nums.length; i += 2) {
      const j = (i + 2) % nums.length;
      shoelace += nums[i] * nums[j + 1] - nums[j] * nums[i + 1];
    }
    expect(Math.abs(shoelace) / 2).toBeCloseTo((480 * 240) / 2, -3);
  });
});
