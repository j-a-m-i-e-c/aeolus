// frontend/src/sandbox/nginx-csp.test.ts — Config/smoke test asserting CSP hardening in nginx.conf
// Parses the two CSP strings from frontend/nginx.conf and validates:
// - Host script-src has neither 'unsafe-eval' nor blob: (Req 11.1)
// - Host worker-src still has 'self' blob: (Req 11.2)
// - Host has frame-src 'self'
// - Sandbox CSP has connect-src 'none' and script-src 'self' blob: (Req 11.3)

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const nginxConf = readFileSync(resolve(__dirname, "../../nginx.conf"), "utf-8");

function extractCspVariable(varName: string): string {
  const re = new RegExp(`set \\$${varName} "([^"]+)"`);
  const match = nginxConf.match(re);
  if (!match) throw new Error(`Could not find $${varName} in nginx.conf`);
  return match[1];
}

function parseDirectives(csp: string): Record<string, string> {
  const directives: Record<string, string> = {};
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      directives[trimmed] = "";
    } else {
      directives[trimmed.slice(0, spaceIdx)] = trimmed.slice(spaceIdx + 1);
    }
  }
  return directives;
}

describe("nginx.conf CSP hardening", () => {
  const hostCsp = extractCspVariable("csp");
  const sandboxCsp = extractCspVariable("sandbox_csp");
  const hostDirectives = parseDirectives(hostCsp);
  const sandboxDirectives = parseDirectives(sandboxCsp);

  describe("Host CSP", () => {
    it("script-src does NOT contain 'unsafe-eval'", () => {
      expect(hostDirectives["script-src"]).not.toContain("'unsafe-eval'");
    });

    it("script-src does NOT contain blob:", () => {
      expect(hostDirectives["script-src"]).not.toContain("blob:");
    });

    it("worker-src still contains 'self' blob: (for Monaco)", () => {
      expect(hostDirectives["worker-src"]).toContain("'self'");
      expect(hostDirectives["worker-src"]).toContain("blob:");
    });

    it("has frame-src 'self'", () => {
      expect(hostDirectives["frame-src"]).toContain("'self'");
    });
  });

  describe("Sandbox asset loading (/assets/)", () => {
    it("serves /assets/ with Access-Control-Allow-Origin so the opaque-origin frame can load its module scripts", () => {
      // The sandbox iframe has an opaque (null) origin, and module scripts always
      // fetch in CORS mode. Without this header the runtime load is blocked and the
      // handshake times out. Assert the /assets/ location declares the CORS header.
      const assetsBlock = nginxConf.match(/location \/assets\/ \{[^}]+\}/);
      expect(assetsBlock, "could not find location /assets/ block").not.toBeNull();
      expect(assetsBlock![0]).toMatch(/add_header\s+Access-Control-Allow-Origin\s+"\*"/);
    });
  });

  describe("Sandbox CSP (/sandbox.html)", () => {
    it("has connect-src 'none' (no network egress)", () => {
      expect(sandboxDirectives["connect-src"]).toBe("'none'");
    });

    it("has script-src 'self' blob: (runtime + compiled component)", () => {
      expect(sandboxDirectives["script-src"]).toContain("'self'");
      expect(sandboxDirectives["script-src"]).toContain("blob:");
    });

    it("has default-src 'none'", () => {
      expect(sandboxDirectives["default-src"]).toBe("'none'");
    });

    it("has form-action 'none'", () => {
      expect(sandboxDirectives["form-action"]).toBe("'none'");
    });
  });
});
