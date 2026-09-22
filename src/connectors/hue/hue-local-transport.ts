import https from "node:https";
import tls, { type DetailedPeerCertificate, type PeerCertificate } from "node:tls";
import { X509Certificate } from "node:crypto";
import logger from "../../logger.js";

/** Minimal response shape the Hue connector needs. */
export interface HueHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type HueFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HueHttpResponse>;

/**
 * Signify's private Hue Bridge root CA from the Hue HTTPS connection guidance.
 * Current bridge certificates chain to this root. Hue deliberately identifies
 * a bridge by its bridge id rather than by its private LAN IP address.
 */
const HUE_BRIDGE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw
OTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty
b290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5
MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv
b3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86
aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22j
OKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV
HQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8
ItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz
IEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO
MAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2
sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
-----END CERTIFICATE-----`;

interface HuePeerCertificate {
  subject?: { CN?: string; O?: string };
  issuer?: { O?: string };
  fingerprint256?: string;
  raw?: Buffer;
}

function normaliseBridgeId(value: string | undefined): string {
  return (value ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function looksLikeHueCertificate(cert: HuePeerCertificate): boolean {
  const organisation = `${cert.subject?.O ?? ""} ${cert.issuer?.O ?? ""}`.toLowerCase();
  return organisation.includes("philips hue") || organisation.includes("signify");
}

/**
 * Validate the identity carried by a Hue bridge certificate.
 *
 * The Hue HTTPS guidance uses the bridge id as the certificate common name.
 * When discovery supplied an id it must match.
 *
 * `chainVerified` says where the trust came from, and that changes what the
 * certificate itself has to prove:
 *
 *   • `false` (default, legacy self-signed probe) — the certificate *is* the
 *     trust decision, so it must carry a bridge-id common name and a Hue/Signify
 *     organisation before Aeolus will learn and pin it.
 *   • `true` (the certificate already chained to the Hue bridge root CA) — the
 *     chain is the proof that this is a genuine Hue bridge, so the organisation
 *     label is not re-checked. Aeolus would otherwise fail closed against every
 *     real bridge the day Signify changes that string. A common name is still
 *     required whenever an expected bridge id has to be compared against it.
 */
export function validateHueCertificateIdentity(
  cert: HuePeerCertificate,
  expectedBridgeId?: string,
  pinnedFingerprint = "",
  { chainVerified = false }: { chainVerified?: boolean } = {},
): { bridgeId: string; fingerprint: string } {
  const commonName = normaliseBridgeId(cert.subject?.CN);
  const expected = normaliseBridgeId(expectedBridgeId);
  const fingerprint = cert.fingerprint256 ?? "";

  if (!chainVerified && (!commonName || !looksLikeHueCertificate(cert))) {
    throw new Error("Hue bridge TLS certificate identity is not recognised");
  }
  if (expected && !commonName) {
    throw new Error(`Hue bridge TLS identity mismatch: expected ${expected}, certificate names no bridge`);
  }
  if (expected && commonName !== expected) {
    throw new Error(`Hue bridge TLS identity mismatch: expected ${expected}, received ${commonName}`);
  }
  if (!chainVerified && !fingerprint) {
    throw new Error("Hue bridge TLS certificate has no SHA-256 fingerprint");
  }
  if (pinnedFingerprint && fingerprint !== pinnedFingerprint) {
    throw new Error("Hue bridge TLS certificate changed during this Aeolus session");
  }

  return { bridgeId: commonName, fingerprint };
}

function isLegacyCertificateError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
}

/**
 * Wall-clock bound for a single local bridge exchange, TLS handshake included.
 *
 * A bridge on the same LAN answers in well under a second. Without this, a host
 * that accepts the TCP connection and then stalls the handshake leaves the
 * promise unsettled for as long as the OS keeps the socket alive, and the
 * connector's caller waits with it.
 */
export const HUE_LOCAL_TIMEOUT_MS = 5000;

interface HueIdentity {
  bridgeId: string;
  fingerprint: string;
}

interface RequestOptions {
  ca: string;
  expectedBridgeId: string | undefined;
  pinnedFingerprint: string;
  /** True when `ca` is the Hue bridge root CA rather than a pinned leaf. */
  chainVerified: boolean;
  timeoutMs: number;
  /** Called once per TLS handshake with the identity that just verified. */
  onIdentity?: (identity: HueIdentity) => void;
}

function requestWithCa(
  target: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  options: RequestOptions,
): Promise<HueHttpResponse> {
  return new Promise((resolve, reject) => {
    const headers = { ...(init.headers ?? {}) };
    if (init.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["Content-Length"] = String(Buffer.byteLength(init.body));
    }

    const req = https.request({
      protocol: "https:",
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? "GET",
      headers,
      ca: options.ca,
      rejectUnauthorized: true,
      // A Hue certificate is issued to the bridge id, not its private IP.
      // Chain validation happens first; this callback replaces IP hostname
      // matching with Hue's documented bridge-id identity check.
      checkServerIdentity: (_hostname: string, cert: PeerCertificate) => {
        try {
          const identity = validateHueCertificateIdentity(
            cert as HuePeerCertificate,
            options.expectedBridgeId,
            options.pinnedFingerprint,
            { chainVerified: options.chainVerified },
          );
          options.onIdentity?.(identity);
          return undefined;
        } catch (error) {
          return error as Error;
        }
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          async json() {
            return raw.length === 0 ? null : JSON.parse(raw);
          },
        });
      });
    });

    // Covers a stalled handshake as well as a stalled response: the timer starts
    // on socket assignment and `destroy(err)` surfaces through the error handler.
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`Hue bridge did not respond within ${options.timeoutMs}ms`));
    });
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * Probe a legacy self-signed bridge before sending any HTTP request or API key.
 * The returned certificate becomes a private trust anchor for this connector
 * session, so the subsequent request still runs with rejectUnauthorized=true.
 */
function probeLegacyCertificate(
  target: URL,
  expectedBridgeId: string | undefined,
  pinnedFingerprint: string,
  timeoutMs: number,
): Promise<{ pem: string } & HueIdentity> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: target.hostname,
      port: target.port ? Number(target.port) : 443,
      rejectUnauthorized: false,
    });

    let settled = false;
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    // A peer that completes TCP but never finishes the handshake would otherwise
    // hold this promise open indefinitely.
    socket.setTimeout(timeoutMs, () => {
      finishWithError(new Error(`Hue bridge TLS probe timed out after ${timeoutMs}ms`));
    });

    socket.once("error", finishWithError);
    socket.once("secureConnect", () => {
      try {
        const cert = socket.getPeerCertificate(true) as DetailedPeerCertificate & HuePeerCertificate;
        const validated = validateHueCertificateIdentity(cert, expectedBridgeId, pinnedFingerprint);
        if (!cert.raw) {
          throw new Error("Hue bridge TLS certificate did not expose its DER bytes");
        }
        const pem = new X509Certificate(cert.raw).toString();
        settled = true;
        socket.setTimeout(0);
        socket.end();
        resolve({ pem, ...validated });
      } catch (error) {
        finishWithError(error as Error);
      }
    });
  });
}

/**
 * HTTPS transport for the local Hue bridge API.
 *
 * Current bridges validate against Signify's Hue Bridge root CA. Older Bridge
 * V2 firmware can still present a legacy self-signed Hue certificate. For that
 * compatibility case Aeolus performs a TLS-only probe first (no HTTP request,
 * credentials or body are sent), validates the bridge identity, then trusts
 * that exact certificate for the connector session. Global TLS verification is
 * never disabled.
 */
export function createHueLocalFetch(options: {
  getExpectedBridgeId: () => string | undefined;
  onObservedBridgeId?: (bridgeId: string) => void;
  /** Per-exchange timeout; defaults to {@link HUE_LOCAL_TIMEOUT_MS}. */
  timeoutMs?: number;
}): HueFetch {
  const timeoutMs = options.timeoutMs ?? HUE_LOCAL_TIMEOUT_MS;
  let observedBridgeId = "";
  let pinnedFingerprint = "";
  let legacyCa = "";

  /**
   * Record the bridge id the certificate just proved. Both paths learn the id,
   * so a connector stored without one picks it up on current firmware too.
   * Only the legacy path pins the fingerprint: there the certificate is the
   * whole trust decision, whereas a CA-validated bridge is free to renew its
   * leaf mid-session without Aeolus rejecting it.
   */
  const rememberBridgeId = (bridgeId: string) => {
    if (bridgeId && !observedBridgeId) {
      observedBridgeId = bridgeId;
      options.onObservedBridgeId?.(bridgeId);
    }
  };

  return async (url, init = {}) => {
    const target = new URL(url);
    if (target.protocol !== "https:") {
      throw new Error("Hue local transport requires HTTPS");
    }

    const expectedBridgeId = options.getExpectedBridgeId() || observedBridgeId || undefined;

    if (legacyCa) {
      return requestWithCa(target, init, {
        ca: legacyCa,
        expectedBridgeId,
        pinnedFingerprint,
        chainVerified: false,
        timeoutMs,
      });
    }

    try {
      const response = await requestWithCa(target, init, {
        ca: HUE_BRIDGE_ROOT_CA,
        expectedBridgeId,
        pinnedFingerprint,
        chainVerified: true,
        timeoutMs,
        onIdentity: ({ bridgeId }) => rememberBridgeId(bridgeId),
      });
      // Chain + identity verification succeeded. A separate preflight is not
      // needed merely to learn the certificate identity for current bridges.
      return response;
    } catch (error) {
      if (!isLegacyCertificateError(error)) throw error;
    }

    const legacy = await probeLegacyCertificate(target, expectedBridgeId, pinnedFingerprint, timeoutMs);
    legacyCa = legacy.pem;
    rememberBridgeId(legacy.bridgeId);
    if (!pinnedFingerprint) pinnedFingerprint = legacy.fingerprint;
    logger.warn(
      { bridge: target.hostname, bridgeId: legacy.bridgeId },
      "Hue bridge uses a legacy self-signed TLS certificate; pinned it for this connector session",
    );
    return requestWithCa(target, init, {
      ca: legacyCa,
      expectedBridgeId: legacy.bridgeId,
      pinnedFingerprint: legacy.fingerprint,
      chainVerified: false,
      timeoutMs,
    });
  };
}
