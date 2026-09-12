// showcase-cleanup §10, §11 — two local runtime modes, not three products.
//
// The drift this guards against: the only way to get simulated hardware locally used
// to be `demo-up`, which also flipped the backend into public-demo mode and rebuilt
// the frontend as an anonymous read-only visitor. Reviewing the showcase on your own
// Pi therefore meant losing authoring, admin and most of the API — for reasons that
// had nothing to do with the showcase.
//
// So the invariant is a separation of concerns, and it is the kind that silently
// re-merges the next time someone needs the simulator in a demo context. These tests
// assert the compose files stay factored:
//
//   base                    real Aeolus, no simulator
//   local-showcase          + simulated hardware, still unrestricted
//   public-demo-local       + visitor restrictions, on top of the showcase
//   hosted-runtime          the internet-facing deployment, hardened

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const base = read("docker-compose.yml");
const showcase = read("demo/compose/local-showcase.yml");
const publicDemoLocal = read("demo/compose/public-demo-local.yml");
const hostedRuntime = read("demo/compose/hosted-runtime.yml");
const hostedBuild = read("demo/compose/hosted-build.yml");
const makefile = read("Makefile");

/** Strip comments so prose explaining a flag is not mistaken for setting it. */
function stripYamlComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

describe("Mode A — real Aeolus (base compose)", () => {
  it("runs no simulator", () => {
    // What someone installing Aeolus for their own site gets. Simulated hardware in
    // this file would put fake devices in a real installation.
    expect(stripYamlComments(base)).not.toContain("AEOLUS_SIMULATOR_ENABLED");
  });

  it("applies no public-demo restrictions", () => {
    const code = stripYamlComments(base);
    expect(code).not.toContain("AEOLUS_PUBLIC_DEMO");
    expect(code).not.toContain("VITE_PUBLIC_DEMO");
  });
});

describe("Mode B — Aeolus + Showcase (local-showcase overlay)", () => {
  it("adds simulated hardware", () => {
    const code = stripYamlComments(showcase);
    expect(code).toContain("simulator:");
    expect(code).toContain('AEOLUS_SIMULATOR_ENABLED: "true"');
  });

  it("does NOT enable public-demo mode", () => {
    // The separation this whole phase exists for. If this fails, reviewing the
    // showcase locally has once again been coupled to becoming a restricted visitor.
    const code = stripYamlComments(showcase);
    expect(code).not.toContain("AEOLUS_PUBLIC_DEMO");
    expect(code).not.toContain("VITE_PUBLIC_DEMO");
    expect(code).not.toContain("DEMO_SESSION_MINUTES");
  });

  it("bootstraps the simulated command profiles when seeding", () => {
    // The one seed-time concern that IS a showcase concern: the simulated actuators
    // need their MQTT command profiles configured once they have published.
    expect(stripYamlComments(showcase)).toContain('AEOLUS_SIMULATOR_BOOTSTRAP: "true"');
  });

  it("provisions no public-demo identity when seeding", () => {
    // Demo group, demo user and per-rule demo_access belong to the visitor
    // deployments. A normal showcase install has a normal admin.
    expect(stripYamlComments(showcase)).not.toContain("AEOLUS_PUBLIC_DEMO");
  });

  it("publishes no port for the simulator", () => {
    // MQTT-only process on the internal broker; nothing should be reachable.
    const block = stripYamlComments(showcase).slice(stripYamlComments(showcase).indexOf("simulator:"));
    expect(block).not.toMatch(/^\s+ports:/m);
  });
});

describe("local public-demo overlay", () => {
  it("exists as its own file rather than being folded into the showcase", () => {
    expect(existsSync(path.join(REPO_ROOT, "demo/compose/public-demo-local.yml"))).toBe(true);
  });

  it("carries the visitor restrictions", () => {
    const code = stripYamlComments(publicDemoLocal);
    expect(code).toContain('AEOLUS_PUBLIC_DEMO: "true"');
    expect(code).toContain('VITE_PUBLIC_DEMO: "true"');
  });

  it("defines no simulator of its own", () => {
    // It composes on top of the showcase overlay, so the simulated hardware is
    // described in exactly one place. A copy here would be free to drift.
    expect(stripYamlComments(publicDemoLocal)).not.toContain("AEOLUS_SIMULATOR_ENABLED");
  });
});

describe("hosted public demo stays separate and hardened", () => {
  it("keeps the visitor restrictions", () => {
    expect(stripYamlComments(hostedRuntime)).toContain('AEOLUS_PUBLIC_DEMO: "true"');
    expect(stripYamlComments(hostedBuild)).toContain('VITE_PUBLIC_DEMO: "true"');
  });

  it("is still a standalone stack, not an overlay on the base", () => {
    // network_mode and networks are mutually exclusive in Compose, so the hosted
    // stack cannot layer host networking away — it must define everything itself.
    expect(hostedRuntime).toContain("name: aeolus-public-demo");
    expect(stripYamlComments(hostedRuntime)).not.toContain("network_mode: host");
  });
});

describe("Make targets read as the modes they start", () => {
  it("offers an unrestricted showcase target", () => {
    expect(makefile).toMatch(/^showcase:/m);
    expect(makefile).toMatch(/^showcase-seed:/m);
  });

  it("names the public-demo target after what it turns on", () => {
    expect(makefile).toMatch(/^public-demo-local:/m);
    expect(makefile).toMatch(/^public-demo-local-seed:/m);
  });

  it("no longer offers the targets that conflated the two modes", () => {
    // `demo-up` was the trap: it read as "start the demo" and meant "restrict this
    // install to an anonymous visitor". Keeping it as an alias would have preserved
    // that, because muscle memory would keep landing on the restricted mode when the
    // simulator was what was wanted. There is also no single correct forwarding
    // target — it did two unrelated things, so the right replacement depends on which
    // one you meant. Failing with `No rule to make target` says that; an alias cannot.
    for (const retired of ["demo-up", "demo-reset", "seed-demo"]) {
      expect(makefile, retired).not.toMatch(new RegExp(`^${retired}:`, "m"));
    }
  });

  it("leaves no dangling .PHONY entry for a target that no longer exists", () => {
    const phony = /^\.PHONY:(.*)$/m.exec(makefile)?.[1] ?? "";
    const declared = phony.trim().split(/\s+/);
    for (const name of declared) {
      expect(makefile, `.PHONY names ${name} but no such target exists`).toMatch(
        new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m"),
      );
    }
  });

  it("does not reach the public-demo overlay from a showcase target", () => {
    const showcaseTarget = /^showcase:[\s\S]*?\n\n/m.exec(makefile)?.[0] ?? "";
    expect(showcaseTarget).not.toContain("public-demo");
  });

  it("keeps the base up target free of both overlays", () => {
    const upTarget = /^up:[\s\S]*?\n\n/m.exec(makefile)?.[0] ?? "";
    expect(upTarget).toContain("docker compose up -d");
    expect(upTarget).not.toContain("local-showcase");
    expect(upTarget).not.toContain("public-demo");
  });
});
