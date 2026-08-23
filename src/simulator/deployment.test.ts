// src/simulator/deployment.test.ts
// phase-2-mqtt-simulator Task 10 — deployment guardrails.
//
// The simulator must be OFF by default and present only in the public-demo
// overlay, with no published ports (Req 10.1, 10.2, 10.8). These assertions read
// the compose files so a future edit that leaks the simulator into the base
// stack, enables it by default, or exposes a port fails loudly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadSimulatorConfig } from "./config.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const baseCompose = readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
const demoCompose = readFileSync(path.join(REPO_ROOT, "docker-compose.demo.yml"), "utf8");
const publicDemoCompose = readFileSync(path.join(REPO_ROOT, "docker-compose.public-demo.yml"), "utf8");

/** Extract the indented block for a named service from a compose file. */
function serviceBlock(compose: string, service: string): string | undefined {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s{2}${service}:\\s*$`).test(line));
  if (start === -1) return undefined;
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    // A new top-level (2-space) service key ends the block.
    if (/^\s{2}\S/.test(lines[i]) && !/^\s{2}\s/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

describe("simulator deployment guardrails", () => {
  it("is disabled by default in configuration", () => {
    expect(loadSimulatorConfig({}).enabled).toBe(false);
  });

  it("has no simulator service and no simulator enablement in the base compose", () => {
    expect(serviceBlock(baseCompose, "simulator")).toBeUndefined();
    expect(baseCompose).not.toContain("AEOLUS_SIMULATOR_ENABLED");
  });

  it("adds an enabled simulator service only in the demo overlay", () => {
    const block = serviceBlock(demoCompose, "simulator");
    expect(block).toBeDefined();
    expect(block).toContain('AEOLUS_SIMULATOR_ENABLED: "true"');
    expect(block).toContain("agriculture");
  });

  it("never publishes a port for the simulator (no public exposure)", () => {
    const block = serviceBlock(demoCompose, "simulator") ?? "";
    // A published port would appear as a `ports:` key inside the service block.
    expect(/^\s{4}ports:/m.test(block)).toBe(false);
    expect(block).toContain("network_mode: host");
  });
});

describe("hardened public demo stack (docker-compose.public-demo.yml)", () => {
  const backend = serviceBlock(publicDemoCompose, "backend") ?? "";
  const mosquitto = serviceBlock(publicDemoCompose, "mosquitto") ?? "";
  const frontend = serviceBlock(publicDemoCompose, "frontend") ?? "";
  const simulator = serviceBlock(publicDemoCompose, "simulator") ?? "";

  it("defines the full self-contained stack including a Cloudflare Tunnel ingress", () => {
    expect(serviceBlock(publicDemoCompose, "cloudflared")).toBeDefined();
    expect(backend).not.toBe("");
    expect(mosquitto).not.toBe("");
    expect(frontend).not.toBe("");
    expect(simulator).not.toBe("");
  });

  it("never uses host networking (bridge only — requirements §13, §21)", () => {
    expect(publicDemoCompose).not.toContain("network_mode: host");
  });

  it("publishes no host ports — Cloudflare Tunnel is the only public ingress", () => {
    // No `ports:` mapping anywhere; the broker's 1883 is never exposed.
    expect(/^\s{4}ports:/m.test(publicDemoCompose)).toBe(false);
    // Reject 1883 only where it would be a *published port*, i.e. a `ports:`
    // sequence entry. A bare `1883:1883` substring search would also flag
    // mosquitto's `user: "1883:1883"`, which is the image's UID:GID and exposes
    // nothing to the host.
    expect(publicDemoCompose).not.toMatch(/^\s*-\s*"?[\d.]+:1883/m);
    expect(backend).not.toContain("ports:");
    expect(frontend).not.toContain("ports:");
    expect(mosquitto).not.toContain("ports:");
  });

  it("mounts no Docker socket into any container", () => {
    expect(publicDemoCompose).not.toContain("/var/run/docker.sock");
  });

  it("applies no-new-privileges, drops capabilities, and sets resource ceilings", () => {
    expect(publicDemoCompose).toContain("no-new-privileges:true");
    expect(publicDemoCompose).toContain("cap_drop");
    expect(publicDemoCompose).toContain("mem_limit");
    expect(publicDemoCompose).toContain("cpus:");
  });

  it("starts stateful public-demo services directly as unprivileged users", () => {
    // cap_drop: ALL means root entrypoints cannot chown/setuid. The public demo
    // therefore starts Aeolus with the host deployment UID/GID and Mosquitto
    // with the official image's fixed 1883:1883 identity.
    expect(backend).toContain('user: "${AEOLUS_RUNTIME_UID:-1000}:${AEOLUS_RUNTIME_GID:-1000}"');
    expect(simulator).toContain('user: "${AEOLUS_RUNTIME_UID:-1000}:${AEOLUS_RUNTIME_GID:-1000}"');
    expect(mosquitto).toContain('user: "1883:1883"');
  });

  it("runs the backend in production public-demo mode against the internal broker", () => {
    expect(backend).toContain('AEOLUS_PUBLIC_DEMO: "true"');
    expect(backend).toContain("NODE_ENV: production");
    expect(backend).toContain("mqtt://mosquitto:1883");
    // Active DB directory only; the golden snapshot is never mounted here.
    expect(backend).toContain("/app/data");
  });

  it("runs the simulator from the built image, not source", () => {
    expect(simulator).toContain('command: ["node", "dist/simulator/index.js"]');
    expect(simulator).toContain('AEOLUS_SIMULATOR_ENABLED: "true"');
    expect(simulator).not.toContain("npx");
    expect(simulator).not.toContain("tsx");
  });
});
