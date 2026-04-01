// src/api/routes/hue.routes.ts — Philips Hue bridge management endpoints

import { Router } from "express";
import { BadRequestError } from "../middleware/error-handler.js";
import logger from "../../logger.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

interface HueCredentials {
  bridgeIp: string;
  apiKey: string;
  bridgeId?: string;
}

const CREDENTIALS_FILE = () => path.join(path.dirname(config.dbPath), "hue-credentials.json");

function loadCredentials(): HueCredentials | null {
  try {
    if (fs.existsSync(CREDENTIALS_FILE())) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE(), "utf-8"));
    }
  } catch {}
  return null;
}

function saveCredentials(creds: HueCredentials): void {
  const dir = path.dirname(CREDENTIALS_FILE());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE(), JSON.stringify(creds, null, 2));
}

export function createHueRoutes(): Router {
  const router = Router();

  /** GET /api/hue/status — check if Hue is configured */
  router.get("/status", (_req, res) => {
    const creds = loadCredentials();
    res.json({
      configured: !!creds,
      bridgeIp: creds?.bridgeIp || null,
    });
  });

  /** GET /api/hue/discover — find Hue bridges on the network */
  router.get("/discover", async (_req, res, next) => {
    try {
      const response = await fetch("https://discovery.meethue.com/");
      if (!response.ok) throw new Error(`Discovery failed: ${response.status}`);
      const bridges = await response.json();
      logger.info({ count: (bridges as unknown[]).length }, "Hue bridges discovered");
      res.json(bridges);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/hue/pair — initiate pairing with a bridge */
  router.post("/pair", async (req, res, next) => {
    try {
      const { bridgeIp } = req.body;
      if (!bridgeIp || typeof bridgeIp !== "string") {
        throw new BadRequestError("bridgeIp is required");
      }

      const response = await fetch(`http://${bridgeIp}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devicetype: "aeolus#dashboard" }),
      });

      const result = await response.json() as Record<string, unknown>[];

      // Check if pairing succeeded
      if (Array.isArray(result) && result[0]) {
        const first = result[0] as Record<string, unknown>;

        if (first.success) {
          const success = first.success as { username: string };
          const creds: HueCredentials = { bridgeIp, apiKey: success.username };
          saveCredentials(creds);
          logger.info({ bridgeIp }, "Hue bridge paired successfully");
          res.json({ success: true, bridgeIp });
          return;
        }

        if (first.error) {
          const error = first.error as { type: number; description: string };
          // Type 101 = link button not pressed
          res.json({ success: false, error: error.description, errorType: error.type });
          return;
        }
      }

      res.json({ success: false, error: "Unexpected response from bridge" });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/hue/lights — list all lights */
  router.get("/lights", async (_req, res, next) => {
    try {
      const creds = loadCredentials();
      if (!creds) {
        res.json({ configured: false, lights: [] });
        return;
      }

      const response = await fetch(`http://${creds.bridgeIp}/api/${creds.apiKey}/lights`);
      if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
      const lights = await response.json();

      const lightList = Object.entries(lights as Record<string, unknown>).map(([id, light]) => {
        const l = light as { name: string; state: { on: boolean; bri: number; hue?: number; sat?: number; reachable: boolean }; type: string };
        return {
          id,
          name: l.name,
          on: l.state.on,
          brightness: l.state.bri,
          hue: l.state.hue,
          saturation: l.state.sat,
          reachable: l.state.reachable,
          type: l.type,
        };
      });

      res.json({ configured: true, lights: lightList });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/hue/lights/:id/state — control a light */
  router.post("/lights/:id/state", async (req, res, next) => {
    try {
      const creds = loadCredentials();
      if (!creds) throw new BadRequestError("Hue bridge not configured");

      const lightId = req.params.id as string;
      const { on, bri, hue, sat } = req.body;

      const state: Record<string, unknown> = {};
      if (on !== undefined) state.on = Boolean(on);
      if (bri !== undefined) state.bri = Math.min(254, Math.max(0, Number(bri)));
      if (hue !== undefined) state.hue = Math.min(65535, Math.max(0, Number(hue)));
      if (sat !== undefined) state.sat = Math.min(254, Math.max(0, Number(sat)));

      const response = await fetch(`http://${creds.bridgeIp}/api/${creds.apiKey}/lights/${lightId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });

      const result = await response.json();
      logger.info({ lightId, state }, "Hue light state updated");
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/hue/unpair — remove stored credentials */
  router.delete("/unpair", (_req, res) => {
    try {
      if (fs.existsSync(CREDENTIALS_FILE())) {
        fs.unlinkSync(CREDENTIALS_FILE());
      }
      logger.info("Hue bridge unpaired");
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false });
    }
  });

  return router;
}