// src/automations/space-iss-track.test.ts
//
// The Live Space map draws the ISS ground track. The marker itself is real (SGP4 via
// wheretheiss.at), but the track around it used to be a rough stand-in:
//
//   const inc=51.64, phase0=Math.asin(clamp(Number(iss.lat)/inc,-1,1));
//   lat = inc*Math.sin(phase0+i*.165)
//   lon = wrapLon(Number(iss.lon)+i*9.3)
//
// Three problems. Latitude as inc*sin(phase) is up to 3 deg out. Longitude advanced a
// hardcoded 9.3 deg per step when the true step runs 5.3 deg at the equator to 14.4
// deg near the turning points. And the phase came from asin(), which only returns the
// ascending quadrant — so the track was drawn heading north-east even while the
// station was descending, wrong roughly half the time, by up to 11,000 km.
//
// The helpers now use the real spherical relations. These tests extract them from the
// shipped UI source and check them against independent physics rather than against a
// restatement of the same formulas.

import { describe, it, expect } from "vitest";
import { transformSync } from "esbuild";
import spaceTab from "../../scripts/seed/tabs/space.mjs";

const EARTH_R = 6371;
const RAD = Math.PI / 180;

interface Fix { lat: number; lon: number }
interface StepResult extends Fix { u: number }

const automation = spaceTab.automations[0] as { scriptSource: string; uiSource: string };
const uiSource = automation.uiSource;

/** Compile the orbital helpers out of the shipped UI source. */
const H = (() => {
  const pick = (name: string): string => {
    const line = uiSource
      .split("\n")
      .find((l) => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name}`));
    if (!line) throw new Error(`helper "${name}" not found in the Live Space UI source`);
    return line;
  };
  const { code } = transformSync(
    [
      pick("clamp"),
      pick("wrapLon"),
      pick("ISS_INC"),
      pick("issPeriodS"),
      pick("issLat"),
      pick("issNode"),
      pick("issPhase"),
      pick("issStep"),
      pick("issTrack"),
      "return { issPeriodS, issLat, issNode, issPhase, issStep, issTrack, ISS_INC };",
    ].join("\n"),
    { loader: "ts" },
  );
  return new Function(code)() as {
    issPeriodS: (altKm: number) => number;
    issLat: (u: number) => number;
    issNode: (u: number) => number;
    issPhase: (lat: number, ascending: boolean) => number;
    issStep: (u0: number, lon0: number, dt: number, periodS: number) => StepResult;
    issTrack: (u0: number, lon0: number, periodS: number, stepS: number, steps: number) => Fix[];
    ISS_INC: number;
  };
})();

/** Great-circle distance between two subsatellite points, km. */
function groundDistance(a: Fix, b: Fix): number {
  const dLat = (b.lat - a.lat) * RAD;
  let dLon = b.lon - a.lon;
  while (dLon > 180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  dLon *= RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PERIOD = H.issPeriodS(420);

describe("the old ground-track approximation is gone", () => {
  it("no longer derives the orbital phase from asin(lat/inc)", () => {
    // That inversion is the direction bug: it can only ever return the ascending
    // quadrant, so a descending pass was drawn climbing.
    expect(uiSource).not.toContain("Math.asin(clamp(Number(iss.lat)/inc");
    expect(uiSource).not.toMatch(/inc\*Math\.sin\(phase0/);
  });

  it("no longer advances longitude by a hardcoded step", () => {
    expect(uiSource).not.toContain("i*9.3");
  });

  it("resolves the branch from consecutive fixes in the Logic", () => {
    // A single fix cannot tell which half of the orbit the station is on.
    expect(automation.scriptSource).toContain('state.set("issAscending"');
    expect(uiSource).toContain('aeolus.read("issAscending")');
  });
});

describe("orbital period", () => {
  it("comes from Kepler's third law on the reported altitude", () => {
    // The published ISS period is about 92.7-93.0 min at its usual altitude.
    expect(H.issPeriodS(420) / 60).toBeCloseTo(92.8, 1);
    expect(H.issPeriodS(400) / 60).toBeLessThan(H.issPeriodS(440) / 60);
  });

  it("falls back to a sane value for a missing or absurd altitude", () => {
    for (const bad of [0, -10, Number.NaN]) {
      expect(H.issPeriodS(bad) / 60).toBeCloseTo(92.8, 1);
    }
  });
});

describe("orbital phase inversion", () => {
  it("round-trips latitude on both branches", () => {
    for (const u of [-170, -120, -60, -10, 0, 10, 60, 120, 170]) {
      const lat = H.issLat(u);
      const ascending = Math.cos(u * RAD) > 0;
      expect(H.issLat(H.issPhase(lat, ascending))).toBeCloseTo(lat, 9);
    }
  });

  it("never exceeds the inclination", () => {
    for (let u = -360; u <= 360; u += 3) {
      expect(Math.abs(H.issLat(u))).toBeLessThanOrEqual(H.ISS_INC + 1e-9);
    }
  });

  it("reaches the inclination at the turning points", () => {
    expect(H.issLat(90)).toBeCloseTo(H.ISS_INC, 6);
    expect(H.issLat(-90)).toBeCloseTo(-H.ISS_INC, 6);
  });
});

describe("direction of travel", () => {
  it.each([
    ["ascending", true, "north"],
    ["descending", false, "south"],
  ])("a %s pass at 33.7N heads %s", (_label, ascending, _want) => {
    const lat0 = 33.7;
    const next = H.issStep(H.issPhase(lat0, ascending as boolean), 0, 60, PERIOD);
    if (ascending) expect(next.lat).toBeGreaterThan(lat0);
    else expect(next.lat).toBeLessThan(lat0);
  });

  it("always drifts eastward over the ground on both branches", () => {
    // Ground speed east is 4.0 km/s at the equator even after Earth's rotation, so
    // the subsatellite point never tracks west.
    for (const ascending of [true, false]) {
      for (const lat0 of [-40, 0, 40]) {
        const u0 = H.issPhase(lat0, ascending);
        const next = H.issStep(u0, 0, 60, PERIOD);
        let dLon = next.lon - 0;
        while (dLon > 180) dLon -= 360;
        while (dLon < -180) dLon += 360;
        expect(dLon, `lat0=${lat0} ascending=${ascending}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("ground track geometry", () => {
  it("moves the subsatellite point at a physically consistent speed everywhere", () => {
    // The strongest independent check available: it constrains latitude AND longitude
    // together. The inertial subsatellite speed is 7.19 km/s; at the equator its
    // heading is 51.64 deg from east, so subtracting Earth's 0.465 km/s eastward
    // rotation gives sqrt(4.00^2 + 5.64^2) = 6.91 km/s. Near the turning points the
    // track runs due east at 7.19 minus 0.29 = 6.90. So it is ~6.9 km/s throughout.
    // The old hardcoded longitude step made this vary wildly.
    for (const ascending of [true, false]) {
      for (const lat0 of [0, 25, 45, 51]) {
        const points = H.issTrack(H.issPhase(lat0, ascending), 0, PERIOD, 60, 46);
        for (let i = 1; i < points.length; i++) {
          const speed = groundDistance(points[i - 1], points[i]) / 60;
          expect(speed, `ascending=${ascending} lat0=${lat0} segment ${i}`).toBeGreaterThan(6.5);
          expect(speed).toBeLessThan(7.3);
        }
      }
    }
  });

  it("is centred on the current fix", () => {
    const points = H.issTrack(H.issPhase(10, true), -45, PERIOD, 60, 46);
    expect(points).toHaveLength(93);
    expect(points[46].lat).toBeCloseTo(10, 6);
    expect(points[46].lon).toBeCloseTo(-45, 6);
  });

  it("spans one orbit, crossing the equator exactly twice", () => {
    const points = H.issTrack(H.issPhase(10, true), -45, PERIOD, 60, 46);
    let crossings = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i - 1].lat < 0 !== points[i].lat < 0) crossings++;
    }
    expect(crossings).toBe(2);
  });

  it("stays within the inclination band and produces no NaN", () => {
    for (const ascending of [true, false]) {
      for (const lon0 of [-179, -90, 0, 90, 179]) {
        for (const p of H.issTrack(H.issPhase(20, ascending), lon0, PERIOD, 60, 46)) {
          expect(Number.isFinite(p.lat)).toBe(true);
          expect(Number.isFinite(p.lon)).toBe(true);
          expect(Math.abs(p.lat)).toBeLessThanOrEqual(H.ISS_INC + 1e-9);
          expect(p.lon).toBeGreaterThanOrEqual(-180);
          expect(p.lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it("regresses the node westward by about 23 degrees per orbit", () => {
    // Earth turns 0.2507 deg/s, so one 92.8 min orbit shifts the track ~23.3 deg west.
    const a = H.issStep(0, 0, 0, PERIOD);
    const b = H.issStep(0, 0, PERIOD, PERIOD);
    let shift = b.lon - a.lon;
    while (shift > 180) shift -= 360;
    while (shift < -180) shift += 360;
    expect(shift).toBeCloseTo(-23.3, 0);
  });

  it("returns to the same latitude after a full orbit", () => {
    for (const lat0 of [-40, 0, 33.7]) {
      const u0 = H.issPhase(lat0, true);
      expect(H.issStep(u0, 0, PERIOD, PERIOD).lat).toBeCloseTo(lat0, 6);
    }
  });
});

describe("marker propagation between fetches", () => {
  it("advances the marker at orbital speed instead of holding a stale fix", () => {
    // The cron polls once a minute and the pane no longer freezes between polls.
    const u0 = H.issPhase(0, true);
    for (const seconds of [15, 30, 60]) {
      const moved = groundDistance({ lat: 0, lon: 0 }, H.issStep(u0, 0, seconds, PERIOD));
      expect(moved / seconds).toBeGreaterThan(6.5);
      expect(moved / seconds).toBeLessThan(7.3);
    }
    // A whole minute of drift is ~415 km, which is what the marker used to lag by.
    expect(groundDistance({ lat: 0, lon: 0 }, H.issStep(u0, 0, 60, PERIOD))).toBeGreaterThan(380);
  });

  it("steps backwards symmetrically", () => {
    const u0 = H.issPhase(25, true);
    const forward = H.issStep(u0, 30, 120, PERIOD);
    const back = H.issStep(forward.u, forward.lon, -120, PERIOD);
    expect(back.lat).toBeCloseTo(H.issLat(u0), 6);
    expect(back.lon).toBeCloseTo(30, 6);
  });

  it("labels a propagated position rather than passing it off as a fresh fix", () => {
    expect(uiSource).toContain("propagated to now");
    // And it stops extrapolating once the fix is far too old to trust.
    expect(uiSource).toContain("fixAgeS<=900");
  });
});
