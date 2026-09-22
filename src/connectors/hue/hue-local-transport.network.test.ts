// src/connectors/hue/hue-local-transport.network.test.ts
//
// Exercises the real HTTPS transport against a local TLS server, because the
// security properties that matter here (chain validation stays on, bridge-id
// identity replaces IP hostname matching, a rogue self-signed certificate is
// still rejected) only exist end to end.
//
// The fixtures below are throwaway self-signed certificates generated purely
// for this test. They are not secrets and are not used by any runtime path.

import https from "node:https";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import logger from "../../logger.js";
import { HueConnector } from "./hue-connector.js";
import { createHueLocalFetch } from "./hue-local-transport.js";

// The "pinned a legacy certificate" warning is emitted once per probe, so its
// call count is a direct signal for how often the transport probed.
const probeWarnings = () => vi.mocked(logger.warn).mock.calls.length;

/** Self-signed, CN = bridge id, O = "Philips Hue" — mimics legacy Bridge V2 firmware. */
const HUE_LIKE_CERT = `-----BEGIN CERTIFICATE-----
MIIDcDCCAligAwIBAgIUYfdeyxaJnfZL35HdK9oYzvLxSX8wDQYJKoZIhvcNAQEL
BQAwPjELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRkwFwYDVQQD
DBAwMDE3ODhBQkNERUYxMjM0MCAXDTI2MDkyMjEwMDYzMVoYDzIxMjYwODI5MTAw
NjMxWjA+MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxGTAXBgNV
BAMMEDAwMTc4OEFCQ0RFRjEyMzQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDgKexwTBrBH11B+W0R58USnPF2sm+HgA9GrC9hCYAB5VxEap81U9/rNGx9
mlvNKj61OL/Hb9ud1JgiKs9bDAYG7BAVumonR7V3Xlr7JPUs8W+GxOFcAyp3etDN
35FkDx6mcqil7CNuwxt9J19IbZbIiiv2p8HtsXN0blKWLCElJx5LgJd6M/wkACPl
DOhzPSflAVNHg2V7bzO1Pi1t84U68fTybk1jyxliACQeygod/Ex7koK8zg5KLaRl
ubyT7Iliy808snYJBtdWqMIshPNlfkDPLO3pjLe1oI3z4905prHQov+qx3pp7drS
cqCuX+rkSX6jlIzGncf9+cjmpruXAgMBAAGjZDBiMB0GA1UdDgQWBBQwES3zGXj7
WwXibQz6zlCEYMD7bDAfBgNVHSMEGDAWgBQwES3zGXj7WwXibQz6zlCEYMD7bDAP
BgNVHRMBAf8EBTADAQH/MA8GA1UdEQQIMAaHBH8AAAEwDQYJKoZIhvcNAQELBQAD
ggEBACq1NkdKgtaVvLNhUJk3yr4HXFWXkSmrmbcYV3Hn4/twMjtoeJKctsSJ7nhd
V4dFxwKXIZqZ0vcFLPtPBKiNxPhliEKVy9Lq2NdrT8A3I8zNyGaKUxVLzHDob/O+
gxfpaqtYI/nwnbXF7BGoM+dTNc+MwjOtpFiRS+DsDUWVF5Snj7FlSe6N70+8C57E
dEHIsgz7hBbIOaxIB3Xv1Hk5iF2PTUGg00OvvN6oAwc7lZkOqw/jKfjReAmziU78
Sw/Bk2KC1+/gp8x1hpK7GaVySsaIarPk20OgR3KtzZF26/+dZ5D9PMHXQ4stiIau
qtmiwjO9Sh/CZuBSoS2BSGeriz8=
-----END CERTIFICATE-----`;

const HUE_LIKE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDgKexwTBrBH11B
+W0R58USnPF2sm+HgA9GrC9hCYAB5VxEap81U9/rNGx9mlvNKj61OL/Hb9ud1Jgi
Ks9bDAYG7BAVumonR7V3Xlr7JPUs8W+GxOFcAyp3etDN35FkDx6mcqil7CNuwxt9
J19IbZbIiiv2p8HtsXN0blKWLCElJx5LgJd6M/wkACPlDOhzPSflAVNHg2V7bzO1
Pi1t84U68fTybk1jyxliACQeygod/Ex7koK8zg5KLaRlubyT7Iliy808snYJBtdW
qMIshPNlfkDPLO3pjLe1oI3z4905prHQov+qx3pp7drScqCuX+rkSX6jlIzGncf9
+cjmpruXAgMBAAECggEAYU3RdG2Ur4AN2zWKQtt4kDvQFNYf05GjD+puJpEZH7mP
86LUuTFPYam/7kWy07wivEeF9+x2SGygHTS4Da2KcDbIRKZGrgZSnx42IA5K3tdu
sfGEYYx+Qp7tRHBnjCeEBnx++IcoWkwXApy0n5vyd9qCeu8XHzaIB2JcNxOwz477
Yn/KN25iG1HKK2ekquToUAvkvZXwpHLubx69lMZJcmJYyt1bYt3CY0saZvFPVcaI
tGhRUBtCpjLJrVX16tpMdT19kDOCRfG3cIYuhjwGp9/ntplI3De3wHJCIz1eeFtH
IO1j8W77Rew2ChjzcD4OuE6pH2N0TN167kdl/9UIAQKBgQD3fI1QL2exz0pnfp2G
O61JdLokYc4/jJ+zTzaOtcd6qQE2gBAXSnIf7BJe7iktCannQFFBtINVKcjBfxr/
hjk7V9fNiN+jgxhRlWzRkW0ci/nMcJ7ymmP+bXrT8z6BYVGCO9OOKfXPxXtQatNQ
V9gBKd1XclmIEm4t/18nWPBv9wKBgQDn3/vNj/nYySgCHNgO1CDUdZFKdN+jiSCJ
mE4Oj9KAIBanlCYAiSOnYaZgPXs6UOKt2ArHAPrJ0Lkd7q+y96tR7zgTvJjGfNMw
f0/RZNxnFaSQ9pczjoGGYflbW1vpnaT03uueuWCrmypMSrDm3EbXrFX3jUQOWQeB
H7Ls72BpYQKBgQCgqnlLHxtgccRJ4Ab/x+o9j8vwJpaw5ugejkRK7XPtC56/9O99
T1U7qBRdEJwmoulsOXMHBttkBFZSV+P9EvRAtExjIIKfMlItVKZqftCpAa5PrKVj
thtIZ2agBoADmlxCAfjbiB4OnpPppxA8TmrqhnUtegzpq51fuzPY5YJiDQKBgQCR
Cx/0xyIPhEz9fVN9ex4KKHy46YDXSDjNOTNikn6nXOsu6lIXNbHSyxeKzgqeQOh6
vFCJiUhXI7QYUC0hsyE8gHpAhlG+n2hvxsOEBSaFaRlnAIk2W+cTy4dyqSRGbzE3
Z5ZV1DnvPoFn9bTQxGugD5I65ufyXah/EfgXk+loIQKBgEYdK2o+gEzHug1oPpX0
217x96zYn/o/2s3+TDvWC8uNbOFFYuvb3MOv69PwYsCCM30lqa800p1oOvnUu4eo
0zVDdBlph0t3etJ9DzQ/1b8za/MNKsfdwaAHPXjaFfw98/rrXhOOOtSyP0SGXx24
bAX+Cbp4uQmZpXuEL8B5eUKe
-----END PRIVATE KEY-----`;

/** Same CN, but not a Hue/Signify organisation — an impostor on the LAN. */
const ROGUE_CERT = `-----BEGIN CERTIFICATE-----
MIIDfjCCAmagAwIBAgIUD0jRxdQIkSbqz9dbEoLZSKsFmFUwDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCTkwxGzAZBgNVBAoMEkRlZmluaXRlbHkgTm90IEh1ZTEZ
MBcGA1UEAwwQMDAxNzg4QUJDREVGMTIzNDAgFw0yNjA5MjIxMDA4MDlaGA8yMTI2
MDgyOTEwMDgwOVowRTELMAkGA1UEBhMCTkwxGzAZBgNVBAoMEkRlZmluaXRlbHkg
Tm90IEh1ZTEZMBcGA1UEAwwQMDAxNzg4QUJDREVGMTIzNDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAMIh2VBVbL9RgmyRLkcQD4e2JRuJ/5GqPBlznrIj
ZCEJBiXZr1avvuayivBfcQNb46O/Br+4GtBoMNNcw9jiMzGj4cfcn3S7TBYqnAoa
xuA7fBwa+gnhJYB3+XHYuotj6qCEVW/HIF93ZJ2pLFIk57HUVHBmpVDNVTHYiclO
vl9+kUS4Ax/fDMK3RS6ORnm369UqIj8TUS4CwN4sXsGxwoVZ84E50+7P2JqpUuFX
ngI5/gRWdTFUoBXZvxsfZ1EdWgstnCoK/oDGe/JrfW/iGabOFPNpLJeaQHPF1wfi
3LF4qSEjxShLc3s99M8fxnJ7LTV/ZNy/c58dt4Xxbhi++tcCAwEAAaNkMGIwHQYD
VR0OBBYEFA64ExFM3573J9eswOWC0F6S9HFqMB8GA1UdIwQYMBaAFA64ExFM3573
J9eswOWC0F6S9HFqMA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEfwAAATAN
BgkqhkiG9w0BAQsFAAOCAQEAJWAI9CyMaZC8nSumHZe+mitEQEFlFKXLmq18X4NN
USeoUlO06RVqw22/A+O16uBtOgNY4MVRiPECvq7UnYvmr1gzxZstfzBkZ+fnJlYf
SOLnNgmHEbp6X4oJvZ8ctowqdiIc59kyrYtHIb4+A3HQal4ghNrMwr/NDkF9EKXc
kBo0cqe2Y2V8e3zgE/MThlbLZez87ppvViLqULtKwFgGkVEII538Tss7QHQ5N9sb
1bH9twAXTLbZC0M1stYiA6hhf1AjUe8EtN040Vj0kRypO1NVUkWVgl5XkOjLMLN+
VKtwrNWs8k4EPE1Q6ugvx4aN/3eJkH20s/YSOSKKw2zOgw==
-----END CERTIFICATE-----`;

const ROGUE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDCIdlQVWy/UYJs
kS5HEA+HtiUbif+RqjwZc56yI2QhCQYl2a9Wr77msorwX3EDW+Ojvwa/uBrQaDDT
XMPY4jMxo+HH3J90u0wWKpwKGsbgO3wcGvoJ4SWAd/lx2LqLY+qghFVvxyBfd2Sd
qSxSJOex1FRwZqVQzVUx2InJTr5ffpFEuAMf3wzCt0UujkZ5t+vVKiI/E1EuAsDe
LF7BscKFWfOBOdPuz9iaqVLhV54COf4EVnUxVKAV2b8bH2dRHVoLLZwqCv6Axnvy
a31v4hmmzhTzaSyXmkBzxdcH4tyxeKkhI8UoS3N7PfTPH8Zyey01f2Tcv3OfHbeF
8W4YvvrXAgMBAAECggEAHYvWTdY6j2HB9nEgOHuWyYJs4mSd65cbv4nr2NPvHOIJ
OACKIajs5qK857m28xpsqpLb3ZkRJ6/74mdnfV5sCT2Wkvsen78T5PnGNvl9VEpp
aMOoU5GbShK4ed3RAn8KCjUp5bHKWQ1MWHyTfMsWImgdE+Bjf8lIkqYQzn04F0Nh
r/51GnZaJO1ssuYotjb1r8y8St/A2PxZyRb9+YUXLDHOLPMEuwzwQCYbncwK327f
nSY+qmlCQ3bwjDCPpCxd4SF7A4xME3mIDy+X43gLwR8+9nBzEBBcOY+D0sJYSpML
eoHgdoqnRbOYjqOWikQ+AIKh3kkvTnenvSHgVatxcQKBgQDsz1d3loalz1xgDytL
KDecZgHFlERn9nUvA23PqLFw0kCZz2TxEWyTduKNg5DoKmzTjQQKu2+XSJFQYgDq
AowxUwadoAkWEjn9ep5AurjSQJND55y0r04i05EkHLMYmuMrUeKpG+GoLJYcKyuz
v9bsfjWqbM2TYX9JpLFvG57SEQKBgQDR3SbSK3zolGDYnX9aHe9Xb2dKkf0T1A5J
r0xpBc1D//EizXSY/3RN4GiFSDnan0egmoNM6mRed6hlMqr5QI2xYAVRSKR09Lzi
pcB0LpLFX7Xxw8ihoFIQDQIkFV0J3J9sMFz+7uHWE99QwvQbYGBpgTUb9ItDW1Pd
pUEJThsWZwKBgQDSsUNsFhQkkFLq8HQfgV/BGgz3gow+R0xJkO5xtPBypc5uStTP
myYUKdE2AVm7BoweyLdQ6SVG33zSnO+dRLkA5ZLcSVfsODk6Ko+Endz0zBl6cCa/
p72IRN482AAMozn8//T/atwh6dGArHRMkCGj9kK/J+DcAQHkPtDTPyrWUQKBgGOU
VUxamD1f0ohWS0x+ccgCM3fdx8E12MW76TzYJOsEMe46oP3MEOq29cFwYQtMktcx
GeZQPenZS00heqEksVcd4cgM+QQJ8Op2jdhTFQ+Ud6fNJ5ERmn7FPWPTwz7fscHL
PQU2YnCLI2aV6vBmjbjiN0oZgk8msae1NyPsLMw3AoGBALVnQaq89QaWsVPXmRP5
R0i96NgMCEwdwFI+Ip+arKpWuVWGYOTZ71m8Kh6zHaJOl3s0/5htUw+BOmV7Zs62
qPJazZsuHzPezpS8h0lzgbZ6Bztsp5Do6Ip/7mUFDy7dv0uHvD1SFqexAdTjmncL
r4jLfSpY65TZgdPzyljPEWUM
-----END PRIVATE KEY-----`;

const BRIDGE_ID = "001788ABCDEF1234";

interface FakeBridge {
  origin: string;
  requests: Array<{ method: string; url: string; body: string; headers: Record<string, string | undefined> }>;
  close(): Promise<void>;
}

type BridgeReply = { status?: number; body?: string };

async function startFakeBridge(
  cert: string,
  key: string,
  reply: (url: string) => BridgeReply = () => ({ status: 200, body: JSON.stringify([{ success: {} }]) }),
): Promise<FakeBridge> {
  const requests: FakeBridge["requests"] = [];

  const server = https.createServer({ cert, key }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
        headers: req.headers as Record<string, string | undefined>,
      });
      const { status = 200, body = "" } = reply(req.url ?? "");
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `https://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

describe("Hue local HTTPS transport", () => {
  const bridges: FakeBridge[] = [];

  async function bridge(cert: string, key: string, reply?: (url: string) => BridgeReply) {
    const started = await startFakeBridge(cert, key, reply);
    bridges.push(started);
    return started;
  }

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((b) => b.close()));
  });

  it("refuses to send Hue traffic over plain HTTP", async () => {
    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => BRIDGE_ID });
    await expect(hueFetch("http://192.168.1.10/api/key/lights")).rejects.toThrow(/requires HTTPS/);
  });

  it("pins a legacy self-signed Hue certificate and completes the request", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY, () => ({
      status: 200,
      body: JSON.stringify({ "1": { name: "Living Room" } }),
    }));
    const observed: string[] = [];
    const hueFetch = createHueLocalFetch({
      getExpectedBridgeId: () => BRIDGE_ID,
      onObservedBridgeId: (id) => observed.push(id),
    });

    const res = await hueFetch(`${server.origin}/api/test-key/lights`);

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "1": { name: "Living Room" } });
    expect(observed).toEqual([BRIDGE_ID]);
    // The failed root-CA attempt must not have reached the HTTP layer, and the
    // identity probe must not have sent a request either: exactly one request.
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe("/api/test-key/lights");
  });

  it("reuses the pinned certificate for later requests instead of probing again", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY);
    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => BRIDGE_ID });

    await hueFetch(`${server.origin}/api/test-key/lights`);
    expect(probeWarnings()).toBe(1);

    const res = await hueFetch(`${server.origin}/api/test-key/lights/1/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });

    expect(res.ok).toBe(true);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].method).toBe("PUT");
    expect(server.requests[1].body).toBe(JSON.stringify({ on: true }));
    expect(server.requests[1].headers["content-length"]).toBe(String(JSON.stringify({ on: true }).length));
    // Still one probe: the pinned certificate was reused, not relearned.
    expect(probeWarnings()).toBe(1);
  });

  it("rejects a self-signed certificate that is not a Hue bridge certificate", async () => {
    const server = await bridge(ROGUE_CERT, ROGUE_KEY);
    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => BRIDGE_ID });

    await expect(hueFetch(`${server.origin}/api/test-key/lights`))
      .rejects.toThrow(/identity is not recognised/);
    expect(server.requests).toHaveLength(0);
  });

  it("rejects a Hue certificate issued to a different bridge", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY);
    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => "0017880000000000" });

    await expect(hueFetch(`${server.origin}/api/test-key/lights`))
      .rejects.toThrow(/TLS identity mismatch/);
    expect(server.requests).toHaveLength(0);
  });

  it("learns the bridge id from a legacy certificate when none was configured", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY);
    const observed: string[] = [];
    const hueFetch = createHueLocalFetch({
      getExpectedBridgeId: () => undefined,
      onObservedBridgeId: (id) => observed.push(id),
    });

    await hueFetch(`${server.origin}/api/test-key/lights`);
    await hueFetch(`${server.origin}/api/test-key/config`);

    // Learned once, then reused rather than re-learned.
    expect(observed).toEqual([BRIDGE_ID]);
  });

  it("surfaces a non-2xx bridge response without throwing", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY, () => ({ status: 503, body: "" }));
    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => BRIDGE_ID });

    const res = await hueFetch(`${server.origin}/api/test-key/lights`);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(await res.json()).toBeNull();
  });

  it("propagates a connection failure instead of falling back to unverified TLS", async () => {
    const server = await bridge(HUE_LIKE_CERT, HUE_LIKE_KEY);
    const origin = server.origin;
    await server.close();
    bridges.splice(bridges.indexOf(server), 1);

    const hueFetch = createHueLocalFetch({ getExpectedBridgeId: () => BRIDGE_ID });
    await expect(hueFetch(`${origin}/api/test-key/lights`)).rejects.toThrow();
  });
});

describe("Hue local HTTPS transport — unresponsive peers", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  /**
   * A TCP listener that never speaks TLS. `stallFromConnection` lets the first
   * connection complete a (self-signed) handshake so the root-CA attempt fails
   * with a legacy-certificate error, and stalls the next one — which is the
   * identity probe.
   */
  async function startStallingPeer(stallFromConnection: number): Promise<string> {
    let connections = 0;
    const open = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      open.add(socket);
      socket.on("close", () => open.delete(socket));
      socket.on("error", () => { /* the client hangs up on timeout */ });
      connections += 1;
      if (connections >= stallFromConnection) return; // hold the socket open, say nothing
      // Complete a real handshake with a self-signed Hue-looking certificate.
      new tls.TLSSocket(socket, { isServer: true, cert: HUE_LIKE_CERT, key: HUE_LIKE_KEY })
        .on("error", () => { /* the client rejects the chain; that is the point */ });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    closers.push(() => new Promise<void>((resolve) => {
      // Stalled sockets are still open by design, so close() would never settle.
      for (const socket of open) socket.destroy();
      open.clear();
      server.close(() => resolve());
    }));
    return `https://127.0.0.1:${port}`;
  }

  it("gives up on a peer that accepts the connection and never completes the handshake", async () => {
    const origin = await startStallingPeer(1);
    const hueFetch = createHueLocalFetch({
      getExpectedBridgeId: () => BRIDGE_ID,
      timeoutMs: 150,
    });

    await expect(hueFetch(`${origin}/api/test-key/lights`))
      .rejects.toThrow(/did not respond within 150ms/);
  });

  it("gives up on an identity probe that stalls after a legacy certificate error", async () => {
    const origin = await startStallingPeer(2);
    const hueFetch = createHueLocalFetch({
      getExpectedBridgeId: () => BRIDGE_ID,
      timeoutMs: 150,
    });

    await expect(hueFetch(`${origin}/api/test-key/lights`))
      .rejects.toThrow(/probe timed out after 150ms/);
  });
});

describe("HueConnector default transport wiring", () => {
  const bridges: FakeBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((b) => b.close()));
  });

  async function hueBridge() {
    const server = await startFakeBridge(HUE_LIKE_CERT, HUE_LIKE_KEY, (url) => ({
      status: 200,
      body: url.endsWith("/lights") ? JSON.stringify({}) : JSON.stringify({}),
    }));
    bridges.push(server);
    return server;
  }

  it("connects over HTTPS and learns the bridge id when none was stored", async () => {
    const server = await hueBridge();
    // The fake bridge listens on an ephemeral port, so the configured address
    // carries it; the connector composes `https://<bridgeIp>/api/...` verbatim.
    const connector = new HueConnector({
      bridgeIp: server.origin.replace("https://", ""),
      apiKey: "test-key",
    });

    await connector.connect();

    expect(connector.getHealthStatus().status).toBe("connected");
    expect(server.requests[0].url).toBe("/api/test-key/lights");
    await connector.dispose();
  });

  it("refuses to talk to a bridge whose certificate is for another bridge id", async () => {
    const server = await hueBridge();
    const connector = new HueConnector({
      bridgeIp: server.origin.replace("https://", ""),
      apiKey: "test-key",
      bridgeId: "0017880000000000",
    });

    await expect(connector.connect()).rejects.toThrow(/TLS identity mismatch/);
    expect(connector.getHealthStatus().status).toBe("disconnected");
    expect(server.requests).toHaveLength(0);
    await connector.dispose();
  });

  it("adopts a bridge id supplied by a later configuration update", async () => {
    const server = await hueBridge();
    const connector = new HueConnector({
      bridgeIp: server.origin.replace("https://", ""),
      apiKey: "test-key",
    });

    connector.onConfigUpdate({ bridgeId: "0017880000000000" });

    await expect(connector.connect()).rejects.toThrow(/TLS identity mismatch/);
    await connector.dispose();
  });
});
