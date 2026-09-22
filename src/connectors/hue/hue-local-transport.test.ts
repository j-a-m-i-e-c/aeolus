import { describe, expect, it } from "vitest";
import { validateHueCertificateIdentity } from "./hue-local-transport.js";

describe("Hue TLS certificate identity", () => {
  const cert = {
    subject: { CN: "001788ABCDEF1234", O: "Philips Hue" },
    issuer: { O: "Philips Hue" },
    fingerprint256: "AA:BB:CC",
  };

  it("accepts a Hue certificate whose CN matches the discovered bridge id", () => {
    expect(validateHueCertificateIdentity(cert, "001788abcdef1234")).toEqual({
      bridgeId: "001788ABCDEF1234",
      fingerprint: "AA:BB:CC",
    });
  });

  it("accepts current Signify-labelled bridge certificates", () => {
    const current = {
      subject: { CN: "001788ABCDEF1234", O: "Signify Netherlands B.V." },
      issuer: { O: "Signify Netherlands B.V." },
      fingerprint256: "11:22:33",
    };
    expect(validateHueCertificateIdentity(current, "001788ABCDEF1234").bridgeId)
      .toBe("001788ABCDEF1234");
  });

  it("rejects a certificate for a different bridge", () => {
    expect(() => validateHueCertificateIdentity(cert, "0017880000000000"))
      .toThrow(/TLS identity mismatch/);
  });

  it("rejects a non-Hue self-signed certificate instead of accepting arbitrary TLS", () => {
    expect(() => validateHueCertificateIdentity({
      subject: { CN: "001788ABCDEF1234", O: "Attacker" },
      issuer: { O: "Attacker" },
      fingerprint256: "AA:BB:CC",
    }, "001788ABCDEF1234")).toThrow(/identity is not recognised/);
  });

  it("rejects a certificate change after the connector has pinned a fingerprint", () => {
    expect(() => validateHueCertificateIdentity(cert, "001788ABCDEF1234", "DIFFERENT"))
      .toThrow(/certificate changed/);
  });

  it("allows legacy stored configurations to learn a Hue bridge id using TOFU", () => {
    expect(validateHueCertificateIdentity(cert)).toEqual({
      bridgeId: "001788ABCDEF1234",
      fingerprint: "AA:BB:CC",
    });
  });

  it("rejects a certificate that carries no SHA-256 fingerprint to pin", () => {
    expect(() => validateHueCertificateIdentity({
      subject: { CN: "001788ABCDEF1234", O: "Philips Hue" },
      issuer: { O: "Philips Hue" },
    }, "001788ABCDEF1234")).toThrow(/no SHA-256 fingerprint/);
  });

  it("rejects a certificate with no common name at all", () => {
    expect(() => validateHueCertificateIdentity({
      subject: { O: "Philips Hue" },
      issuer: { O: "Philips Hue" },
      fingerprint256: "AA:BB:CC",
    })).toThrow(/identity is not recognised/);
  });
});

describe("Hue TLS certificate identity — already chained to the Hue root CA", () => {
  const chainVerified = { chainVerified: true };

  it("does not re-check the organisation label, so a Signify rename cannot lock Aeolus out", () => {
    // The chain is the proof that this is a Hue bridge. Requiring a particular
    // O string on top of it would fail closed against every genuine bridge the
    // day Signify changes it.
    const renamed = {
      subject: { CN: "001788ABCDEF1234", O: "Signify Nederland Holding B.V." },
      issuer: { O: "Signify Nederland Holding B.V." },
      fingerprint256: "11:22:33",
    };
    expect(validateHueCertificateIdentity(renamed, "001788ABCDEF1234", "", chainVerified))
      .toEqual({ bridgeId: "001788ABCDEF1234", fingerprint: "11:22:33" });
  });

  it("still rejects a chained certificate issued to a different bridge", () => {
    const other = {
      subject: { CN: "0017880000000000", O: "Signify Netherlands B.V." },
      issuer: { O: "Signify Netherlands B.V." },
      fingerprint256: "11:22:33",
    };
    expect(() => validateHueCertificateIdentity(other, "001788ABCDEF1234", "", chainVerified))
      .toThrow(/TLS identity mismatch/);
  });

  it("refuses to wave through an expected bridge id the certificate does not name", () => {
    const anonymous = {
      subject: { O: "Signify Netherlands B.V." },
      issuer: { O: "Signify Netherlands B.V." },
      fingerprint256: "11:22:33",
    };
    expect(() => validateHueCertificateIdentity(anonymous, "001788ABCDEF1234", "", chainVerified))
      .toThrow(/names no bridge/);
  });

  it("reports the bridge id so a connector stored without one can learn it", () => {
    const cert = {
      subject: { CN: "001788ABCDEF1234", O: "Signify Netherlands B.V." },
      issuer: { O: "Signify Netherlands B.V." },
      fingerprint256: "11:22:33",
    };
    expect(validateHueCertificateIdentity(cert, undefined, "", chainVerified).bridgeId)
      .toBe("001788ABCDEF1234");
  });
});
