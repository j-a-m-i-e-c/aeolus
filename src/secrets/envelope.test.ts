// src/secrets/envelope.test.ts — authenticated encryption of stored secrets.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { connectorContext, EnvelopeError, isEnvelope, openSecret, parseEnvelope, sealSecret, settingContext, type RootKey } from "./envelope.js";

const root: RootKey = { id: "k1", key: randomBytes(32) };
const other: RootKey = { id: "k1", key: randomBytes(32) };
const keyFor = (ring: RootKey[]) => (id: string) => ring.find((key) => key.id === id);
const SECRET = "hue-bridge-key-0123456789abcdef";
const at = connectorContext("instance-1", "apiKey");

function reason(work: () => unknown): string {
  try { work(); } catch (error) { if (error instanceof EnvelopeError) return error.reason; throw error; }
  throw new Error("expected an EnvelopeError");
}

describe("sealSecret / openSecret", () => {
  it("round-trips, and the envelope reveals nothing of the plaintext", () => {
    const sealed = sealSecret(SECRET, root, "connector-secret", at);
    expect(isEnvelope(sealed)).toBe(true);
    expect(sealed).toMatch(/^aeolus-enc:v1:k1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+$/);
    expect(sealed.includes(SECRET)).toBe(false);
    expect(openSecret(sealed, keyFor([root]), "connector-secret", at)).toBe(SECRET);
  });

  it("uses a fresh nonce every time", () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 1000; i += 1) nonces.add(parseEnvelope(sealSecret(SECRET, root, "connector-secret", at)).nonce.toString("hex"));
    expect(nonces.size).toBe(1000);
  });

  it("round-trips empty and non-ASCII values", () => {
    for (const value of ["", "pässwörd ✓", "x".repeat(10_000)]) {
      expect(openSecret(sealSecret(value, root, "setting-secret", settingContext("k")), keyFor([root]), "setting-secret", settingContext("k"))).toBe(value);
    }
  });

  it("refuses a ciphertext moved to another record, field, setting or purpose", () => {
    const sealed = sealSecret(SECRET, root, "connector-secret", at);
    const ring = keyFor([root]);
    expect(reason(() => openSecret(sealed, ring, "connector-secret", connectorContext("instance-2", "apiKey")))).toBe("authentication-failed");
    expect(reason(() => openSecret(sealed, ring, "connector-secret", connectorContext("instance-1", "token")))).toBe("authentication-failed");
    expect(reason(() => openSecret(sealed, ring, "setting-secret", at))).toBe("authentication-failed");
    const setting = sealSecret(SECRET, root, "setting-secret", settingContext("jwt_secret"));
    expect(reason(() => openSecret(setting, ring, "setting-secret", settingContext("mqtt_backend_password")))).toBe("authentication-failed");
  });

  it("refuses the wrong key, an unknown key id, and a relabelled key id", () => {
    const sealed = sealSecret(SECRET, root, "connector-secret", at);
    expect(reason(() => openSecret(sealed, keyFor([other]), "connector-secret", at))).toBe("authentication-failed");
    expect(reason(() => openSecret(sealed, keyFor([]), "connector-secret", at))).toBe("unknown-key");
    // Same key bytes under another id: the id is authenticated, so this fails too.
    const relabelled = sealed.replace(":k1:", ":k2:");
    expect(reason(() => openSecret(relabelled, keyFor([{ id: "k2", key: root.key }]), "connector-secret", at))).toBe("authentication-failed");
  });

  it("detects any modified byte of nonce, ciphertext or tag", () => {
    const sealed = sealSecret(SECRET, root, "connector-secret", at);
    const parts = sealed.split(":");
    for (const index of [3, 4]) {
      const raw = Buffer.from(parts[index]!, "base64url");
      for (const position of [0, raw.length - 1]) {
        const flipped = Buffer.from(raw);
        flipped[position]! ^= 0x01;
        const tampered = [...parts.slice(0, index), flipped.toString("base64url"), ...parts.slice(index + 1)].join(":");
        expect(reason(() => openSecret(tampered, keyFor([root]), "connector-secret", at)), `part ${index} byte ${position}`).toBe("authentication-failed");
      }
    }
  });

  it("parses strictly", () => {
    for (const bad of ["plain", "aeolus-enc:v1:k1:abc", "aeolus-enc:v1:k1:a:b:c", "aeolus-enc:v1:bad id:AAAAAAAAAAAAAAAA:AAAA", `aeolus-enc:v1:k1:${"A".repeat(10)}:${"A".repeat(30)}`, "aeolus-enc:v1:k1:AAAAAAAAAAAAAAAA:AA"]) {
      expect(reason(() => parseEnvelope(bad)), bad).toBe("malformed");
    }
    expect(reason(() => parseEnvelope("aeolus-enc:v9:k1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA"))).toBe("unsupported-version");
    expect(isEnvelope(42)).toBe(false);
  });

  it("refuses invalid root keys, and errors never contain the secret", () => {
    expect(reason(() => sealSecret(SECRET, { id: "k1", key: randomBytes(16) }, "connector-secret", at))).toBe("malformed");
    expect(reason(() => sealSecret(SECRET, { id: "no spaces", key: randomBytes(32) }, "connector-secret", at))).toBe("malformed");
    try {
      openSecret(sealSecret(SECRET, root, "connector-secret", at), keyFor([other]), "connector-secret", at);
    } catch (error) {
      expect(String((error as Error).message).includes(SECRET)).toBe(false);
    }
  });
});
