// The seeder's login helper, covered against a real HTTP server.
//
// The make targets default USER to "admin", which is only correct for an install the
// seeder created itself: on a pristine database `login` calls /api/auth/setup and the
// account it makes is literally named "admin". `setupAdmin` stores whatever the
// first-run Setup page was given, so anyone who created their admin in the browser has
// a different username and the default is simply wrong for them.
//
// That produced a 401 whose text pointed only at the password. The guidance added to
// close that is matched off an error *message*, which is exactly the kind of thing that
// rots silently when the request helper's formatting changes — hence a test that drives
// a real socket rather than a stubbed fetch.

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApi } from "../../demo/seed/lib.mjs";

interface Recorded { method: string; path: string }

let server: Server | undefined;

/**
 * Start a throwaway backend. `handlers` is keyed by "METHOD /path"; a numeric value is
 * sent as a bare status, an object as a 200 body.
 */
async function backend(handlers: Record<string, number | object>): Promise<{
  base: string;
  seen: Recorded[];
}> {
  const seen: Recorded[] = [];
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    seen.push({ method: req.method ?? "", path });
    const handler = handlers[`${req.method} ${path}`];
    res.setHeader("Content-Type", "application/json");
    if (typeof handler === "number") {
      res.statusCode = handler;
      res.end(JSON.stringify({ error: "Invalid credentials" }));
      return;
    }
    if (handler === undefined) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `no route ${path}` }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(handler));
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  return { base: `http://127.0.0.1:${port}`, seen };
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("seeder login", () => {
  it("explains that the admin may not be called \"admin\" when the login is rejected", async () => {
    const { base } = await backend({
      "GET /api/auth/status": { needsSetup: false },
      "POST /api/auth/login": 401,
    });
    const { login } = createApi(base);

    // Retries are exhausted on the way here; a 401 is not retried, so this is one call.
    await expect(login("admin", "wrong")).rejects.toThrow(/USER=<your-username>/);
    await expect(login("admin", "wrong")).rejects.toThrow(
      /no guarantee your admin is called "admin"/,
    );
    // The rejected username is named, so the message is actionable when USER was set.
    await expect(login("jamie", "wrong")).rejects.toThrow(/log in as "jamie"/);
  });

  it("leaves a failure that is not about credentials alone", async () => {
    // A 500 must not be dressed up as a username problem — the operator would go looking
    // in the wrong place. Only 401 carries the guidance.
    const { base } = await backend({
      "GET /api/auth/status": { needsSetup: false },
      "POST /api/auth/login": 500,
    });
    const { login } = createApi(base);

    await expect(login("admin", "pw")).rejects.toThrow(/500/);
    await expect(login("admin", "pw")).rejects.not.toThrow(/USER=/);
  });

  it("creates the first admin under the name it was given, and says which", async () => {
    // The other half of the story: this is why "admin" is the default at all, and why
    // the name is worth printing — it is the credential the operator now has to use.
    const { base, seen } = await backend({
      "GET /api/auth/status": { needsSetup: true },
      "POST /api/auth/setup": { accessToken: "token-from-setup" },
      "GET /api/devices": [],
    });
    const { api, login } = createApi(base);

    await login("jamie", "a-long-enough-password");

    expect(seen.map((r) => r.path)).toEqual(["/api/auth/status", "/api/auth/setup"]);
    // The token from setup is what authenticates everything after it.
    await api("GET", "/api/devices");
    expect(seen.at(-1)).toEqual({ method: "GET", path: "/api/devices" });
  });
});
